import { NextResponse, type NextRequest } from "next/server";
import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { createAdminClient } from "@/lib/supabase/admin";

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
        const { error } = await admin.from("profiles").upsert(
          {
            user_id: u.id,
            email: primary?.email_address ?? u.email_addresses?.[0]?.email_address ?? null,
            full_name:
              [u.first_name, u.last_name].filter(Boolean).join(" ") || null,
            mfa_enabled: Boolean(u.two_factor_enabled),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" }
        );
        if (error) throw error;
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
