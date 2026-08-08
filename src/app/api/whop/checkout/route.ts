import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
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

  // Business and Yearly are flat prices with a fixed cap, so they have no
  // per-vehicle seat count; their limit comes from the plan, not from what was
  // bought. Hoisted out of the call because the whop_checkouts row below has
  // to store the same number.
  const seats = PLANS[plan].perVehicle
    ? Math.max(1, billableVehicles(parsed.data.fleet))
    : null;

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://motorwise.co";
  const result = await createCheckoutSession({
    plan,
    monthlyPrice: price,
    seats,
    orgId: org.id,
    redirectUrl: `${siteUrl}/pricing?checkout=success`,
  });

  if (!result.ok) {
    console.error("whop checkout failed", result.status, result.error);
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  // Record what this session is for BEFORE handing it to the browser. Whop
  // drops the metadata we send it (see migration 0023), so this row is the
  // only thing that will tell the webhook whose garage to upgrade.
  //
  // A failure here is fatal to the checkout on purpose. The alternative is
  // letting someone pay for a session that can never be attributed — money
  // taken, plan never granted, and a refund to arrange by hand.
  const { error: recordError } = await createAdminClient()
    .from("whop_checkouts")
    .upsert(
      {
        session_id: result.session.sessionId,
        org_id: org.id,
        plan,
        seats,
        price,
      },
      { onConflict: "session_id" }
    );

  if (recordError) {
    console.error("could not record whop checkout", recordError);
    return NextResponse.json(
      {
        error:
          "We couldn't start checkout safely just now, so we've stopped before taking any payment. Please try again in a moment.",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    sessionId: result.session.sessionId,
    planId: result.session.planId,
    purchaseUrl: result.session.purchaseUrl,
    price,
    // Sent back rather than read from a NEXT_PUBLIC_ twin so the embed can
    // never target a different Whop than the one that created the session.
    // That mismatch is invisible until checkout renders Whop's own 404 page
    // inside the payment box.
    environment: whopEnvironment(),
  });
}
