import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getPaddle, priceIdForPlan } from "@/lib/paddle";
import { PLANS, type PaidPlanId } from "@/lib/plans";

/**
 * Changing an existing subscription: more vehicles on Premium, or switching
 * between Premium and Business.
 *
 * This exists because the obvious alternative is wrong. Opening a second
 * Paddle checkout does not upgrade anyone — it creates a *second*
 * subscription and bills them twice. Real changes go through Paddle's
 * subscription-update API, which prorates: the customer pays only the
 * difference for the remainder of the current billing period.
 *
 * Trust model: the browser says what it wants, never what it costs. The org
 * comes from the session, the subscription ID is read server-side from our
 * own database, and Paddle calculates the money.
 */
export const runtime = "nodejs";

const bodySchema = z.object({
  plan: z.enum(["pro", "business"]),
  /** Vehicles to pay for. Forced to 1 for Business, which is flat-rate. */
  quantity: z.number().int().min(1).max(1000).optional(),
  /** Price the change without applying it, so the user can approve it first. */
  preview: z.boolean().optional(),
});

/** Paddle returns money in minor units as a string ("1050" = $10.50). */
function formatMoney(amount: string | undefined, currency: string | undefined) {
  const minor = Number(amount ?? 0);
  if (!Number.isFinite(minor)) return null;
  return {
    amount: Math.abs(minor) / 100,
    currency: currency ?? "USD",
    negative: minor < 0,
  };
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const plan = parsed.data.plan as PaidPlanId;
  const preview = parsed.data.preview ?? false;
  const quantity = PLANS[plan].perVehicle ? (parsed.data.quantity ?? 1) : 1;

  const paddle = getPaddle();
  if (!paddle) {
    return NextResponse.json(
      { error: "Billing isn't configured yet." },
      { status: 503 }
    );
  }

  // Which org is this? Read under RLS, so a user can only reach their own.
  const supabase = await createClient();
  const { data: membership } = await supabase
    .from("memberships")
    .select("org_id")
    .limit(1)
    .maybeSingle();
  const orgId = membership?.org_id as string | undefined;
  if (!orgId) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  // The subscription ID is service-role data: users never see or send it.
  const admin = createAdminClient();
  const { data: sub } = await admin
    .from("subscriptions")
    .select("billing_subscription_id")
    .eq("org_id", orgId)
    .maybeSingle();

  const subscriptionId = sub?.billing_subscription_id as string | undefined;
  if (!subscriptionId) {
    // Nothing to change — the caller should open a fresh checkout instead.
    return NextResponse.json({ error: "no_subscription" }, { status: 409 });
  }

  const priceId = priceIdForPlan(plan);
  if (!priceId) {
    return NextResponse.json(
      { error: "That plan isn't available right now." },
      { status: 503 }
    );
  }

  const payload = {
    items: [{ priceId, quantity }],
    // Charge (or credit) the difference now and keep the existing renewal
    // date. "do_not_bill" would hand out the upgrade free until renewal.
    prorationBillingMode: "prorated_immediately" as const,
  };

  try {
    if (preview) {
      const p = await paddle.subscriptions.previewUpdate(
        subscriptionId,
        payload
      );
      const summary = p.updateSummary;
      return NextResponse.json({
        preview: true,
        plan,
        quantity,
        charge: formatMoney(
          summary?.result?.amount,
          summary?.result?.currencyCode
        ),
        action: summary?.result?.action ?? null,
        nextBilledAt: p.nextBilledAt ?? null,
      });
    }

    const result = await paddle.subscriptions.update(subscriptionId, payload);

    // The Paddle webhook is the authority on the plan column and will confirm
    // this within seconds. Writing it here too means the UI is correct
    // immediately instead of after a round trip through Paddle.
    await admin
      .from("organizations")
      .update({ plan, seats: PLANS[plan].perVehicle ? quantity : null })
      .eq("id", orgId);

    return NextResponse.json({
      ok: true,
      plan,
      quantity,
      nextBilledAt: result.nextBilledAt ?? null,
    });
  } catch (err) {
    console.error("paddle subscription update failed", err);
    return NextResponse.json(
      {
        error:
          "Couldn't update your subscription. Nothing was charged — please try again, or contact us if it persists.",
      },
      { status: 502 }
    );
  }
}
