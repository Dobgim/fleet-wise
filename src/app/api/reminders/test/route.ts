import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { emailConfigured, sendEmail } from "@/lib/email";
import { buildReminderEmail } from "@/lib/emails/reminder-template";
import { getMaintenanceItems } from "@/lib/insights";
import type { ServiceRecord, ServiceType, Vehicle } from "@/lib/types";

/**
 * Send the signed-in user a reminder email on demand, so they can see exactly
 * what the daily job would send. Reads only their own org (via RLS), sends
 * only to their own address, and does not touch reminder_log — so it can be
 * run as often as needed for testing.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  if (!emailConfigured()) {
    return NextResponse.json(
      {
        error:
          "Email sending isn't set up yet. Add a Brevo or Resend key in the server settings first.",
      },
      { status: 503 }
    );
  }

  const [{ data: orgRow }, { data: vehicleRows }, { data: recordRows }] =
    await Promise.all([
      supabase.from("organizations").select("name").limit(1).maybeSingle(),
      supabase.from("vehicles").select("*"),
      supabase.from("service_records").select("*"),
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
    return NextResponse.json(
      {
        error: "nothing_due",
        message:
          "Nothing is due or overdue right now, so there's nothing to remind you about. Add a service dated more than 6 months ago (e.g. an oil change) to make one overdue, then try again.",
      },
      { status: 200 }
    );
  }

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL || "https://fleet-wise-delta.vercel.app";
  const { subject, html } = buildReminderEmail({
    garageName: orgRow?.name ?? "your garage",
    items,
    siteUrl,
    logoUrl: `${siteUrl}/logo.png`,
  });

  const result = await sendEmail({ to: user.email, subject, html });
  if (!result.ok) {
    return NextResponse.json(
      { error: `Could not send the email: ${result.error}` },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ok: true,
    sentTo: user.email,
    itemCount: items.length,
  });
}
