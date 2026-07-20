import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe, priceIdForPlan, stripeConfigured } from "@/lib/stripe";

/**
 * Start a Stripe Checkout for a paid plan.
 *
 * Flow: authenticate the user → find their organization → ensure it has a
 * Stripe customer (created and stored on first purchase) → open a hosted
 * Checkout session for the chosen plan's price. The actual plan change is NOT
 * made here; it happens when Stripe confirms payment via the webhook, so a
 * user cannot get a plan without paying.
 */

const bodySchema = z.object({ plan: z.enum(["pro", "business"]) });

export async function POST(request: Request) {
  if (!stripeConfigured()) {
    return NextResponse.json(
      { error: "Card payments aren't set up yet. Please try again later." },
      { status: 503 }
    );
  }
  const stripe = getStripe()!;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
  }
  const priceId = priceIdForPlan(parsed.data.plan);
  if (!priceId) {
    return NextResponse.json(
      { error: "That plan isn't available for purchase yet." },
      { status: 503 }
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: membership } = await admin
    .from("memberships")
    .select("org_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  if (!membership?.org_id) {
    return NextResponse.json({ error: "No organization found" }, { status: 400 });
  }
  const orgId = membership.org_id;

  const { data: org } = await admin
    .from("organizations")
    .select("id, name, stripe_customer_id")
    .eq("id", orgId)
    .maybeSingle();

  // Ensure a Stripe customer exists for this org, stored for reuse.
  let customerId = org?.stripe_customer_id as string | null;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email ?? undefined,
      name: org?.name ?? undefined,
      metadata: { org_id: orgId },
    });
    customerId = customer.id;
    await admin
      .from("organizations")
      .update({ stripe_customer_id: customerId })
      .eq("id", orgId);
  }

  const origin =
    process.env.NEXT_PUBLIC_SITE_URL ||
    request.headers.get("origin") ||
    "https://fleet-wise-delta.vercel.app";

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    // org_id on the subscription so the webhook can map it back reliably.
    subscription_data: { metadata: { org_id: orgId } },
    metadata: { org_id: orgId, plan: parsed.data.plan },
    allow_promotion_codes: true,
    success_url: `${origin}/pricing?checkout=success`,
    cancel_url: `${origin}/pricing?checkout=cancelled`,
  });

  return NextResponse.json({ url: session.url });
}
