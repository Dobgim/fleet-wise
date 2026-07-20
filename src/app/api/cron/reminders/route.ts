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

    const items = getMaintenanceItems(vehicles, records);
    if (items.length === 0) {
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

    // Claim today's send first: the unique (org_id, sent_on) index makes this
    // the lock. If the insert conflicts, someone already sent today.
    const { error: logErr } = await supabase.from("reminder_log").insert({
      org_id: org.id,
      sent_on: today,
      item_count: items.length,
      recipient,
    });
    if (logErr) {
      summary.skippedAlreadySent++;
      continue;
    }

    const { subject, html } = buildReminderEmail({
      garageName: org.name,
      items,
      siteUrl,
      logoUrl,
    });
    const result = await sendEmail({ to: recipient, subject, html });

    if (result.ok) {
      summary.sent++;
    } else {
      summary.failed.push(`${org.name}: ${result.error}`);
      // Release the claim so tomorrow's run (or a manual retry) can try again.
      await supabase
        .from("reminder_log")
        .delete()
        .eq("org_id", org.id)
        .eq("sent_on", today);
    }
  }

  return NextResponse.json({ ok: true, date: today, ...summary });
}
