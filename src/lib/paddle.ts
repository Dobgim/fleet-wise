import { Environment, Paddle } from "@paddle/paddle-node-sdk";
import type { PlanId } from "./types";

/**
 * Server-side Paddle client. Paddle is the merchant of record: it is the
 * legal seller, so it collects and remits sales tax worldwide and pays out
 * to Cameroon — which is why it is used here rather than Stripe.
 *
 * Built lazily so the app still runs (in simulated-billing mode) before any
 * Paddle credentials exist.
 */
let cached: Paddle | null = null;

export function getPaddle(): Paddle | null {
  const key = process.env.PADDLE_API_KEY;
  if (!key) return null;
  if (!cached) {
    cached = new Paddle(key, {
      // Sandbox until PADDLE_ENV says otherwise, so a mistake cannot charge
      // a real card.
      environment:
        process.env.PADDLE_ENV === "production"
          ? Environment.production
          : Environment.sandbox,
    });
  }
  return cached;
}

export function paddleConfigured(): boolean {
  return Boolean(process.env.PADDLE_API_KEY);
}

/** Which Paddle Price a paid plan maps to. Free has no price. */
export function priceIdForPlan(plan: PlanId): string | null {
  switch (plan) {
    case "pro":
      return process.env.NEXT_PUBLIC_PADDLE_PRICE_PRO || null;
    case "business":
      return process.env.NEXT_PUBLIC_PADDLE_PRICE_BUSINESS || null;
    default:
      return null;
  }
}

/** Reverse lookup: which plan a Paddle Price belongs to. */
export function planForPriceId(priceId: string | null | undefined): PlanId | null {
  if (!priceId) return null;
  if (priceId === process.env.NEXT_PUBLIC_PADDLE_PRICE_PRO) return "pro";
  if (priceId === process.env.NEXT_PUBLIC_PADDLE_PRICE_BUSINESS) return "business";
  return null;
}
