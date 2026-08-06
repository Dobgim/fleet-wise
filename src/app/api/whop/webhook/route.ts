import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { cancelMembership } from "@/lib/whop";
import { emailConfigured, sendEmail } from "@/lib/email";
import { buildSubscriptionEmail } from "@/lib/emails/subscription-email";
import type { PlanId } from "@/lib/types";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Whop webhook — the single source of truth for who is on a paid plan.
 *
 * The plan column is locked away from users (migration 0003); it is written
 * ONLY here, with the service role, and only after Whop's signature has been
 * verified. That is what makes paying non-optional: a user cannot grant
 * themselves a plan, and this endpoint cannot be forged without the secret.
 */

// Signature verification needs the raw, unparsed body.
export const runtime = "nodejs";

/**
 * Verify a Standard Webhooks signature.
 *
 * Implemented here rather than pulled from Whop's SDK because this runs on
 * Cloudflare Workers, where every dependency is bundle weight and cold-start
 * time, and the algorithm is thirty lines: HMAC-SHA256 over
 * "{id}.{timestamp}.{body}", base64, compared in constant time.
 */
function verifySignature(
  rawBody: string,
  headers: Headers,
  secret: string
): boolean {
  const id = headers.get("webhook-id");
  const timestamp = headers.get("webhook-timestamp");
  const signature = headers.get("webhook-signature");
  if (!id || !timestamp || !signature) return false;

  // Reject anything older than five minutes so a captured request cannot be
  // replayed later to re-grant a cancelled plan.
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;

  // Standard Webhooks secrets are "whsec_" + base64. Whop's own examples
  // base64-encode the raw string instead, so accept both rather than fail
  // verification on a formatting difference.
  const key = secret.startsWith("whsec_")
    ? Buffer.from(secret.slice("whsec_".length), "base64")
    : Buffer.from(secret, "utf8");

  const expected = crypto
    .createHmac("sha256", key)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest("base64");

  // The header may carry several space-separated versioned signatures during
  // a secret rotation; any one matching is a pass.
  return signature.split(" ").some((part) => {
    const value = part.startsWith("v1,") ? part.slice(3) : part;
    const a = Buffer.from(value);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}

/** The owner's email address for a garage, or null if we cannot find one. */
async function ownerEmail(admin: Admin, orgId: string): Promise<string | null> {
  const { data: membership } = await admin
    .from("memberships")
    .select("user_id")
    .eq("org_id", orgId)
    .eq("role", "owner")
    .limit(1)
    .maybeSingle();
  if (!membership?.user_id) return null;
  const { data } = await admin
    .from("profiles")
    .select("email")
    .eq("user_id", membership.user_id)
    .maybeSingle();
  return data?.email ?? null;
}

function pick(obj: unknown, ...keys: string[]): unknown {
  if (!obj || typeof obj !== "object") return undefined;
  for (const k of keys) {
    const v = (obj as Record<string, unknown>)[k];
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

/**
 * Apply a membership to the garage that bought it.
 *
 * `valid` is Whop's word for "this membership entitles access right now" and
 * covers active and trialing alike, so it is what decides the plan rather
 * than enumerating every status string Whop might add later.
 */
async function applyMembership(data: unknown, valid: boolean) {
  const admin = createAdminClient();

  const metadata = pick(data, "metadata") as Record<string, unknown> | undefined;
  const orgId = typeof metadata?.org_id === "string" ? metadata.org_id : null;
  if (!orgId) {
    // Without org_id we cannot attribute the payment. Log loudly rather than
    // silently upgrading the wrong account.
    console.error("whop membership without org_id metadata", pick(data, "id"));
    return;
  }

  const membershipId =
    typeof pick(data, "id") === "string" ? (pick(data, "id") as string) : null;
  const paidPlan =
    metadata?.plan === "pro" || metadata?.plan === "business"
      ? (metadata.plan as PlanId)
      : null;
  const plan: PlanId = valid && paidPlan ? paidPlan : "free";

  const seatsRaw = Number(metadata?.seats);
  const seats =
    plan === "pro" && Number.isFinite(seatsRaw) && seatsRaw > 0
      ? Math.floor(seatsRaw)
      : null;

  // Read before writing, so the receipt email fires on a real upgrade only —
  // not on every renewal or status tick Whop sends.
  const { data: before } = await admin
    .from("organizations")
    .select("plan, name")
    .eq("id", orgId)
    .maybeSingle();
  const upgraded = plan !== "free" && before?.plan !== plan;

  // Whop has no quantity, so changing vehicle count means buying a second
  // subscription. Retire the one it replaces, or the garage pays twice.
  if (valid && membershipId) {
    const { data: previous } = await admin
      .from("subscriptions")
      .select("billing_subscription_id")
      .eq("org_id", orgId)
      .maybeSingle();
    const old = previous?.billing_subscription_id;
    if (old && old !== membershipId) {
      const result = await cancelMembership(old);
      if (!result.ok) {
        // Never fatal: the new subscription is already paid for, and a 500
        // here would make Whop retry the whole event.
        console.error("could not cancel replaced membership", old, result.error);
      }
    }
  }

  await admin.from("organizations").update({ plan, seats }).eq("id", orgId);

  if (upgraded && emailConfigured()) {
    try {
      const to = await ownerEmail(admin, orgId);
      if (to) {
        const siteUrl =
          process.env.NEXT_PUBLIC_SITE_URL || "https://motorwise.co";
        const { subject, html } = buildSubscriptionEmail({
          garageName: before?.name ?? "your garage",
          // `upgraded` is only true for a paid plan, so this narrowing holds.
          plan: plan as "pro" | "business",
          seats,
          siteUrl,
          logoUrl: `${siteUrl}/logo.png`,
        });
        const result = await sendEmail({ to, subject, html });
        if (!result.ok) console.error("subscription email failed", result.error);
      }
    } catch (err) {
      // The subscription is already active; a failed email must never make
      // Whop think the webhook failed and retry the whole thing.
      console.error("subscription email error", err);
    }
  }

  const periodEnd = pick(
    data,
    "renewal_period_end",
    "expires_at",
    "current_period_end"
  );

  await admin.from("subscriptions").upsert(
    {
      org_id: orgId,
      plan: paidPlan ?? "free",
      status: valid ? "active" : "canceled",
      billing_subscription_id: membershipId,
      current_period_end:
        typeof periodEnd === "string"
          ? periodEnd
          : typeof periodEnd === "number"
            ? new Date(periodEnd * 1000).toISOString()
            : null,
    },
    { onConflict: "org_id" }
  );
}

export async function POST(request: Request) {
  const secret = process.env.WHOP_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Whop not configured" }, { status: 503 });
  }

  const rawBody = await request.text();
  if (!verifySignature(rawBody, request.headers, secret)) {
    console.error("whop signature verification failed");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Unreadable event" }, { status: 400 });
  }

  // Whop has used both "action" and "event" for the type across API versions.
  const type = String(pick(event, "action", "event", "type") ?? "");
  const data = pick(event, "data") ?? event;

  try {
    switch (type) {
      case "membership.activated":
      case "membership_went_valid":
        await applyMembership(data, true);
        break;

      case "membership.deactivated":
      case "membership_went_invalid":
        await applyMembership(data, false);
        break;

      default:
        // Whop sends many event types; ignore the ones we do not act on.
        // payment.succeeded needs no handling: the membership events already
        // carry the entitlement, and acting on both would double-process.
        break;
    }
  } catch (err) {
    console.error("whop handler error", type, err);
    return NextResponse.json({ error: "Handler error" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
