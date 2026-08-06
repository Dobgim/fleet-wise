import { NextResponse, type NextRequest } from "next/server";
import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailConfigured, sendEmail } from "@/lib/email";
import { buildWelcomeEmail } from "@/lib/emails/welcome-email";
import { SUPPORT_EMAIL } from "@/lib/company";
import { FREE_VEHICLES, PLANS } from "@/lib/plans";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Sends the welcome email exactly once per user.
 *
 * The claim comes first and the send second. Getting that order right is the
 * whole point: claiming after sending would let a retry that arrives mid-send
 * mail the user twice, whereas claiming first means a crash between the two
 * loses one email rather than duplicating it. For a welcome message that is
 * the better failure.
 */
async function sendWelcomeEmail(
  admin: Admin,
  userId: string,
  email: string,
  firstName: string | null
): Promise<void> {
  if (!emailConfigured()) return;

  // Atomic claim: only the delivery that actually flips NULL -> now() gets a
  // row back, so only it sends.
  const { data: claimed, error: claimError } = await admin
    .from("profiles")
    .update({ welcome_email_sent_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("welcome_email_sent_at", null)
    .select("user_id");

  if (claimError) throw claimError;
  if (!claimed?.length) return; // already sent, or another delivery won

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://motorwise.co";
  const { subject, html } = buildWelcomeEmail({
    firstName,
    freeVehicles: FREE_VEHICLES,
    pricePerVehicle: PLANS.pro.price,
    siteUrl,
    logoUrl: `${siteUrl}/logo.png`,
    supportEmail: SUPPORT_EMAIL,
  });

  const result = await sendEmail({ to: email, subject, html });
  if (!result.ok) {
    // Release the claim so Clerk's retry can try again — a welcome email that
    // failed on a transient Resend error should not be lost forever.
    await admin
      .from("profiles")
      .update({ welcome_email_sent_at: null })
      .eq("user_id", userId);
    throw new Error(result.error);
  }
}

/**
 * Keeps `public.profiles` in step with Clerk.
 *
 * Two things in this system need to know about a user without a browser
 * present, and neither can call Clerk cheaply in a loop:
 *
 *  - the nightly reminder cron, which needs an email address per owner;
 *  - the 2FA policy in Postgres, which must know whether a user has 2FA on
 *    before it can decide whether to demand proof of it.
 *
 * So Clerk pushes changes here and we mirror the two fields we need. This is
 * the only writer: the table is service-role-only, because a user who could
 * set their own mfa_enabled to false could switch off their own protection.
 */
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!process.env.CLERK_WEBHOOK_SIGNING_SECRET) {
    return NextResponse.json({ error: "Clerk webhook not configured" }, { status: 503 });
  }

  let event;
  try {
    // Verifies the Svix signature against the raw body. An unsigned or
    // replayed request never reaches the database.
    event = await verifyWebhook(request);
  } catch (err) {
    console.error("clerk webhook verification failed", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const admin = createAdminClient();

  try {
    switch (event.type) {
      case "user.created":
      case "user.updated": {
        const u = event.data;
        const primary = u.email_addresses?.find(
          (e) => e.id === u.primary_email_address_id
        );
        const email =
          primary?.email_address ?? u.email_addresses?.[0]?.email_address ?? null;
        const { error } = await admin.from("profiles").upsert(
          {
            user_id: u.id,
            email,
            full_name:
              [u.first_name, u.last_name].filter(Boolean).join(" ") || null,
            mfa_enabled: Boolean(u.two_factor_enabled),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" }
        );
        if (error) throw error;

        // Only on creation. user.updated fires on every profile change, and
        // the claim marker alone would not stop a welcome email going out to
        // an existing user who simply turned on 2FA.
        if (event.type === "user.created" && email) {
          await sendWelcomeEmail(admin, u.id, email, u.first_name ?? null);
        }
        break;
      }

      case "user.deleted": {
        // Clerk sends only the id here. Removing the membership orphans the
        // organization, which is intended: the data stays recoverable for
        // support, and nothing can read it since no one is a member.
        const id = event.data.id;
        if (id) {
          await admin.from("profiles").delete().eq("user_id", id);
          await admin.from("memberships").delete().eq("user_id", id);
        }
        break;
      }

      default:
        // Clerk sends many event types; ignore the ones we do not act on.
        break;
    }
  } catch (err) {
    console.error("clerk webhook handler error", event.type, err);
    // 500 makes Clerk retry, which is what we want for a transient DB error.
    return NextResponse.json({ error: "Handler error" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
