import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@/lib/supabase/server";
import {
  billableVehicles,
  monthlyCost,
  PLANS,
  type PaidPlanId,
} from "@/lib/plans";
import {
  createCheckoutSession,
  whopEnvironment,
  whopMissingConfig,
} from "@/lib/whop";

/**
 * Start a Whop checkout for the signed-in user's garage.
 *
 * The price is computed here from the fleet size, never accepted from the
 * browser: a client that could name its own price could buy an unlimited
 * fleet for a dollar. The browser only says which plan and how many vehicles
 * it wants to cover.
 */
export const runtime = "nodejs";

const bodySchema = z.object({
  plan: z.enum(["pro", "business", "yearly"]),
  // Total fleet size the customer wants covered, not the billable count.
  fleet: z.number().int().min(1).max(1000),
});

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  const plan = parsed.data.plan as PaidPlanId;

  if (whopMissingConfig(plan).length > 0) {
    return NextResponse.json(
      {
        error: `Checkout isn't configured yet — missing ${whopMissingConfig(plan).join(" and ")}.`,
      },
      { status: 503 }
    );
  }

  // RLS restricts this to the caller's own garage, so the org id cannot be
  // spoofed by sending someone else's.
  const supabase = await createClient();
  const { data: org } = await supabase
    .from("organizations")
    .select("id")
    .limit(1)
    .maybeSingle();

  if (!org?.id) {
    return NextResponse.json(
      {
        error:
          "Your workspace hasn't finished setting up, so there's nothing to attach a subscription to. Reload the page — if it keeps happening, contact us.",
      },
      { status: 409 }
    );
  }

  const price = monthlyCost(plan, parsed.data.fleet);

  // A per-vehicle plan priced at zero would be a free subscription that still
  // grants a paid allowance. Refuse rather than sell nothing.
  if (price <= 0) {
    return NextResponse.json(
      {
        error: `At ${parsed.data.fleet} vehicles you are still within the free allowance — there is nothing to pay for yet.`,
      },
      { status: 400 }
    );
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://motorwise.co";
  const result = await createCheckoutSession({
    plan,
    monthlyPrice: price,
    // Business is a flat price with a fixed cap, so it has no per-vehicle
    // seat count; its limit comes from the plan, not from what was bought.
    seats: PLANS[plan].perVehicle
      ? Math.max(1, billableVehicles(parsed.data.fleet))
      : null,
    orgId: org.id,
    redirectUrl: `${siteUrl}/pricing?checkout=success`,
  });

  if (!result.ok) {
    console.error("whop checkout failed", result.status, result.error);
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  return NextResponse.json({
    sessionId: result.session.sessionId,
    planId: result.session.planId,
    price,
    // Sent back rather than read from a NEXT_PUBLIC_ twin so the embed can
    // never target a different Whop than the one that created the session.
    // That mismatch is invisible until checkout renders Whop's own 404 page
    // inside the payment box.
    environment: whopEnvironment(),
  });
}
