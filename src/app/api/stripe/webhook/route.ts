import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe, planForPriceId } from "@/lib/stripe";
import type { PlanId } from "@/lib/types";

/**
 * Stripe webhook — the single source of truth for who is on a paid plan.
 *
 * The plan column is locked from users (migration 0003); it is written ONLY
 * here, via the service role, and only in response to a Stripe event whose
 * signature we have verified. That is what makes paying non-optional: a user
 * cannot grant themselves a plan, and this endpoint cannot be spoofed without
 * the signing secret.
 */

// Stripe needs the raw, unparsed body to verify the signature.
export const runtime = "nodejs";

async function syncSubscription(sub: Stripe.Subscription) {
  const admin = createAdminClient();
  const orgId = sub.metadata?.org_id;
  if (!orgId) {
    console.error("subscription without org_id metadata", sub.id);
    return;
  }

  const priceId = sub.items.data[0]?.price?.id;
  const paidPlan = planForPriceId(priceId);

  // Active/trialing keeps the paid plan; anything else drops to free.
  const active = sub.status === "active" || sub.status === "trialing";
  const plan: PlanId = active && paidPlan ? paidPlan : "free";

  await admin.from("organizations").update({ plan }).eq("id", orgId);

  await admin.from("subscriptions").upsert(
    {
      org_id: orgId,
      plan: paidPlan ?? "free",
      status: sub.status,
      stripe_subscription_id: sub.id,
      current_period_end: sub.items.data[0]?.current_period_end
        ? new Date(sub.items.data[0].current_period_end * 1000).toISOString()
        : null,
    },
    { onConflict: "org_id" }
  );
}

export async function POST(request: Request) {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const body = await request.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, secret);
  } catch (err) {
    console.error("webhook signature verification failed", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.subscription) {
          const sub = await stripe.subscriptions.retrieve(
            session.subscription as string
          );
          // Carry org_id onto the subscription if Checkout metadata had it.
          if (!sub.metadata?.org_id && session.metadata?.org_id) {
            await stripe.subscriptions.update(sub.id, {
              metadata: { org_id: session.metadata.org_id },
            });
            sub.metadata = { ...sub.metadata, org_id: session.metadata.org_id };
          }
          await syncSubscription(sub);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        await syncSubscription(event.data.object as Stripe.Subscription);
        break;
      }
      default:
        // Ignore the many event types we don't act on.
        break;
    }
  } catch (err) {
    console.error("webhook handler error", event.type, err);
    return NextResponse.json({ error: "Handler error" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
