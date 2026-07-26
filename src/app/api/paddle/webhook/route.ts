import { NextResponse } from "next/server";
import { EventName } from "@paddle/paddle-node-sdk";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPaddle, planForPriceId } from "@/lib/paddle";
import type { PlanId } from "@/lib/types";

/**
 * Paddle webhook — the single source of truth for who is on a paid plan.
 *
 * The plan column is locked away from users (migration 0003); it is written
 * ONLY here, with the service role, and only after Paddle's signature has
 * been verified. That is what makes paying non-optional: a user cannot grant
 * themselves a plan, and this endpoint cannot be forged without the signing
 * secret.
 */

// Signature verification needs the raw, unparsed body.
export const runtime = "nodejs";

interface Subscriptionish {
  id: string;
  status: string;
  customData?: Record<string, unknown> | null;
  items?: { price?: { id?: string } | null }[];
  currentBillingPeriod?: { endsAt?: string | null } | null;
}

async function applySubscription(sub: Subscriptionish) {
  const admin = createAdminClient();

  const orgId =
    typeof sub.customData?.org_id === "string" ? sub.customData.org_id : null;
  if (!orgId) {
    // Without org_id we cannot attribute the payment. Log loudly rather than
    // silently upgrading the wrong account.
    console.error("paddle subscription without org_id custom data", sub.id);
    return;
  }

  const priceId = sub.items?.[0]?.price?.id ?? null;
  const paidPlan = planForPriceId(priceId);

  // Only an active or trialing subscription keeps the paid plan.
  const active = sub.status === "active" || sub.status === "trialing";
  const plan: PlanId = active && paidPlan ? paidPlan : "free";

  await admin.from("organizations").update({ plan }).eq("id", orgId);

  await admin.from("subscriptions").upsert(
    {
      org_id: orgId,
      plan: paidPlan ?? "free",
      status: sub.status,
      billing_subscription_id: sub.id,
      current_period_end: sub.currentBillingPeriod?.endsAt ?? null,
    },
    { onConflict: "org_id" }
  );
}

export async function POST(request: Request) {
  const paddle = getPaddle();
  const secret = process.env.PADDLE_WEBHOOK_SECRET;
  if (!paddle || !secret) {
    return NextResponse.json({ error: "Paddle not configured" }, { status: 503 });
  }

  const signature = request.headers.get("paddle-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const rawBody = await request.text();

  let event;
  try {
    event = await paddle.webhooks.unmarshal(rawBody, secret, signature);
  } catch (err) {
    console.error("paddle signature verification failed", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }
  if (!event) {
    return NextResponse.json({ error: "Unreadable event" }, { status: 400 });
  }

  try {
    switch (event.eventType) {
      case EventName.SubscriptionCreated:
      case EventName.SubscriptionUpdated:
      case EventName.SubscriptionActivated:
      case EventName.SubscriptionCanceled:
      case EventName.SubscriptionPastDue:
      case EventName.SubscriptionPaused:
      case EventName.SubscriptionResumed:
        await applySubscription(event.data as unknown as Subscriptionish);
        break;
      default:
        // Paddle sends many event types; ignore the ones we do not act on.
        break;
    }
  } catch (err) {
    console.error("paddle handler error", event.eventType, err);
    return NextResponse.json({ error: "Handler error" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
