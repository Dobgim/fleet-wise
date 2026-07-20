import Stripe from "stripe";
import type { PlanId } from "./types";

/**
 * Server-side Stripe client. The secret key is never exposed to the browser.
 * Instantiated lazily so the app still builds and runs (in simulated-billing
 * mode) when no Stripe key is configured yet.
 */
let cached: Stripe | null = null;

export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!cached) cached = new Stripe(key);
  return cached;
}

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/** Which Stripe Price a paid plan maps to. Free has no price. */
export function priceIdForPlan(plan: PlanId): string | null {
  switch (plan) {
    case "pro":
      return process.env.STRIPE_PRICE_PRO || null;
    case "business":
      return process.env.STRIPE_PRICE_BUSINESS || null;
    default:
      return null;
  }
}

/** Reverse lookup: which plan a Stripe Price belongs to. */
export function planForPriceId(priceId: string | undefined | null): PlanId | null {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_PRICE_PRO) return "pro";
  if (priceId === process.env.STRIPE_PRICE_BUSINESS) return "business";
  return null;
}
