import type { PaidPlanId } from "./plans";

/**
 * Server-side Whop billing. Whop is the merchant of record: it is the legal
 * seller, so it collects and remits sales tax worldwide and pays out to
 * Cameroon — which is why it is used here rather than Stripe.
 *
 * Whop's checkout has no quantity concept, unlike the per-unit pricing this
 * app used before. So a per-vehicle price is expressed as a plan created at
 * checkout time with `renewal_price` already multiplied out: five vehicles
 * over the free allowance is one plan at $25/month, not five units at $5.
 * `monthlyCost()` in plans.ts stays the single source of that arithmetic.
 */

const SANDBOX_BASE = "https://sandbox-api.whop.com/api/v1";
const PRODUCTION_BASE = "https://api.whop.com/api/v1";

/** Sandbox unless explicitly told otherwise, so a mistake cannot take money. */
export function whopBase(): string {
  return process.env.WHOP_ENV === "production" ? PRODUCTION_BASE : SANDBOX_BASE;
}

export function whopConfigured(): boolean {
  return Boolean(process.env.WHOP_API_KEY && process.env.WHOP_COMPANY_ID);
}

/** What is missing, named exactly — a generic "not configured" costs hours. */
export function whopMissingConfig(): string[] {
  const missing: string[] = [];
  if (!process.env.WHOP_API_KEY) missing.push("WHOP_API_KEY");
  if (!process.env.WHOP_COMPANY_ID) missing.push("WHOP_COMPANY_ID");
  return missing;
}

async function whopFetch(
  path: string,
  init: { method: string; body?: unknown }
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${whopBase()}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${process.env.WHOP_API_KEY}`,
      "Content-Type": "application/json",
    },
    ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
  });
  let json: Record<string, unknown> = {};
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    // A non-JSON body from Whop is itself the diagnostic; keep the status.
  }
  return { ok: res.ok, status: res.status, json };
}

export interface CheckoutSession {
  sessionId: string;
  planId: string | null;
}

/**
 * Create a one-off checkout for exactly this org, plan and price.
 *
 * The org id travels in metadata and comes back on the webhook, which is how
 * a payment is attributed to the right garage. Everything else about the
 * subscription — who may have it, what it costs — is decided here on the
 * server, never sent up from the browser.
 */
export async function createCheckoutSession(params: {
  plan: PaidPlanId;
  monthlyPrice: number;
  seats: number | null;
  orgId: string;
  redirectUrl: string;
}): Promise<
  | { ok: true; session: CheckoutSession }
  | { ok: false; status: number; error: string }
> {
  const body: Record<string, unknown> = {
    company_id: process.env.WHOP_COMPANY_ID,
    plan: {
      plan_type: "renewal",
      billing_period: "monthly",
      renewal_price: params.monthlyPrice,
      currency: "usd",
      ...(process.env.WHOP_ACCESS_PASS_ID && {
        access_pass_id: process.env.WHOP_ACCESS_PASS_ID,
      }),
    },
    metadata: {
      org_id: params.orgId,
      plan: params.plan,
      // Read back by the webhook as the vehicle allowance. Whop cannot derive
      // it from the price, because the price is already multiplied out.
      seats: params.seats === null ? "" : String(params.seats),
    },
    redirect_url: params.redirectUrl,
  };

  const { ok, status, json } = await whopFetch("/checkout_configurations", {
    method: "POST",
    body,
  });

  if (!ok) {
    const error =
      (typeof json.error === "string" && json.error) ||
      (typeof json.message === "string" && json.message) ||
      `Whop rejected the checkout (HTTP ${status}).`;
    return { ok: false, status, error };
  }

  const sessionId = typeof json.id === "string" ? json.id : null;
  if (!sessionId) {
    return {
      ok: false,
      status: 502,
      error: "Whop did not return a checkout session id.",
    };
  }
  const plan = json.plan as { id?: unknown } | undefined;

  return {
    ok: true,
    session: {
      sessionId,
      planId: typeof plan?.id === "string" ? plan.id : null,
    },
  };
}

/**
 * End a membership immediately.
 *
 * Used when an upgrade replaces an existing subscription. Immediate rather
 * than at-period-end because the replacement is already active: leaving the
 * old one running would bill the same garage twice for the same month.
 */
export async function cancelMembership(
  membershipId: string
): Promise<{ ok: boolean; error?: string }> {
  const { ok, status, json } = await whopFetch(
    `/memberships/${encodeURIComponent(membershipId)}/cancel`,
    { method: "POST", body: { cancellation_mode: "immediate" } }
  );
  if (ok) return { ok: true };
  const error =
    (typeof json.error === "string" && json.error) ||
    `HTTP ${status} cancelling membership ${membershipId}`;
  return { ok: false, error };
}
