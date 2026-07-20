import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe, stripeConfigured } from "@/lib/stripe";

/**
 * Open the Stripe billing portal so a subscriber can change their card,
 * download invoices, or cancel — all handled by Stripe's hosted UI. Cancels
 * flow back through the webhook, which drops the org to the free plan.
 */
export async function POST(request: Request) {
  if (!stripeConfigured()) {
    return NextResponse.json({ error: "Billing not set up" }, { status: 503 });
  }
  const stripe = getStripe()!;

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
  const { data: org } = await admin
    .from("organizations")
    .select("stripe_customer_id")
    .eq("id", membership?.org_id ?? "")
    .maybeSingle();

  const customerId = org?.stripe_customer_id as string | null;
  if (!customerId) {
    return NextResponse.json(
      { error: "No billing account yet — subscribe to a plan first." },
      { status: 400 }
    );
  }

  const origin =
    process.env.NEXT_PUBLIC_SITE_URL ||
    request.headers.get("origin") ||
    "https://fleet-wise-delta.vercel.app";

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${origin}/pricing`,
  });

  return NextResponse.json({ url: session.url });
}
