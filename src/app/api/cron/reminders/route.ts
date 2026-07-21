import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailConfigured, sendEmail } from "@/lib/email";
import { buildReminderEmail } from "@/lib/emails/reminder-template";
import { getMaintenanceItems } from "@/lib/insights";
import type { ServiceRecord, ServiceType, Vehicle } from "@/lib/types";

/**
 * Daily maintenance reminders.
 *
 * Runs on a schedule (see vercel.json) and, for every garage that has
 * reminders enabled, emails the owner about services that are overdue or due
 * within 30 days. Uses the service role because it must read across all
 * organizations — every query is therefore scoped by org_id by hand.
 *
 * Safety properties:
 * - Requires CRON_SECRET, so the endpoint cannot be triggered by outsiders.
 * - Writes reminder_log (unique on org_id + date) BEFORE sending, so a retry
 *   or double trigger on the same day cannot email anyone twice.
 * - Skips garages with nothing due; silence is the correct output.
 */

export const maxDuration = 60;

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization");
  return header === `Bearer ${secret}`;
}

interface OrgRow {
  id: string;
  name: string;
  reminders_enabled: boolean;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY is not configured" },
      { status: 503 }
    );
  }
  if (!emailConfigured()) {
    return NextResponse.json(
      { error: "No email provider configured (set BREVO_API_KEY or RESEND_API_KEY)" },
      { status: 503 }
    );
  }

  const supabase = createAdminClient();
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL || "https://fleet-wise-delta.vercel.app";
  const logoUrl = `${siteUrl}/logo.png`;
  const today = new Date().toISOString().slice(0, 10);

  const { data: orgs, error: orgErr } = await supabase
    .from("organizations")
    .select("id, name, reminders_enabled")
    .eq("reminders_enabled", true);

  if (orgErr) {
    return NextResponse.json({ error: orgErr.message }, { status: 500 });
  }

  const summary = {
    checked: 0,
    sent: 0,
    skippedNothingDue: 0,
    skippedAlreadySent: 0,
    skippedNoRecipient: 0,
    failed: [] as string[],
  };

  for (const org of (orgs ?? []) as OrgRow[]) {
    summary.checked++;

    const [{ data: vehicleRows }, { data: recordRows }] = await Promise.all([
      supabase.from("vehicles").select("*").eq("org_id", org.id),
      supabase.from("service_records").select("*").eq("org_id", org.id),
    ]);

    const vehicles: Vehicle[] = (vehicleRows ?? []).map((v) => ({
      id: v.id,
      registration: v.registration,
      vin: v.vin ?? "",
      make: v.make,
      model: v.model,
      mileage: Number(v.mileage),
      createdAt: v.created_at,
    }));
    const records: ServiceRecord[] = (recordRows ?? []).map((r) => ({
      id: r.id,
      vehicleId: r.vehicle_id,
      type: r.type as ServiceType,
      cost: Number(r.cost),
      serviceDate: r.service_date,
      notes: r.notes ?? "",
      createdAt: r.created_at,
    }));

    // The reminder policy: one email when a service comes within 7 days of
    // its predicted date, one more if it tips into overdue. The dashboard
    // keeps its wider 30-day view; email is deliberately less chatty.
    const candidates = getMaintenanceItems(vehicles, records)
      .filter((it) => it.status === "overdue" || it.daysDiff <= 7)
      .map((it) => ({ item: it, stage: it.status }));
    if (candidates.length === 0) {
      summary.skippedNothingDue++;
      continue;
    }

    // Who owns this garage?
    const { data: membership } = await supabase
      .from("memberships")
      .select("user_id")
      .eq("org_id", org.id)
      .eq("role", "owner")
      .limit(1)
      .maybeSingle();

    if (!membership?.user_id) {
      summary.skippedNoRecipient++;
      continue;
    }
    const { data: userInfo } = await supabase.auth.admin.getUserById(
      membership.user_id
    );
    const recipient = userInfo?.user?.email;
    if (!recipient) {
      summary.skippedNoRecipient++;
      continue;
    }

    // Exactly-once per predicted service: claim rows in reminder_item_log
    // first. The unique (vehicle, type, due_date, stage) index means an item
    // already claimed — today or any earlier day — inserts nothing, so it can
    // never be emailed twice.
    const claims = candidates.map(({ item, stage }) => ({
      org_id: org.id,
      vehicle_id: item.vehicle.id,
      service_type: item.type,
      due_date: item.dueDate,
      stage,
      recipient,
    }));
    const { data: claimed, error: claimErr } = await supabase
      .from("reminder_item_log")
      .upsert(claims, {
        onConflict: "vehicle_id,service_type,due_date,stage",
        ignoreDuplicates: true,
      })
      .select("vehicle_id, service_type, due_date, stage");

    if (claimErr) {
      summary.failed.push(`${org.name}: claim failed — ${claimErr.message}`);
      continue;
    }
    if (!claimed || claimed.length === 0) {
      summary.skippedAlreadySent++;
      continue;
    }

    // Email only the items whose claim WE won this run.
    const won = new Set(
      claimed.map((c) => `${c.vehicle_id}:${c.service_type}:${c.due_date}:${c.stage}`)
    );
    const toSend = candidates
      .filter(({ item, stage }) =>
        won.has(`${item.vehicle.id}:${item.type}:${item.dueDate}:${stage}`)
      )
      .map(({ item }) => item);

    const { subject, html } = buildReminderEmail({
      garageName: org.name,
      items: toSend,
      siteUrl,
      logoUrl,
    });
    const result = await sendEmail({ to: recipient, subject, html });

    if (result.ok) {
      summary.sent++;
    } else {
      summary.failed.push(`${org.name}: ${result.error}`);
      // Release only our claims so the next run retries them.
      for (const c of claimed) {
        await supabase
          .from("reminder_item_log")
          .delete()
          .eq("vehicle_id", c.vehicle_id)
          .eq("service_type", c.service_type)
          .eq("due_date", c.due_date)
          .eq("stage", c.stage);
      }
    }
  }

  return NextResponse.json({ ok: true, date: today, ...summary });
}
