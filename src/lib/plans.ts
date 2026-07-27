import type { EffectivePlan, PlanId } from "./types";

/** Plans that can actually be bought. "free" is a state, not a product. */
export type PaidPlanId = Extract<PlanId, "pro" | "business">;

export interface PlanConfig {
  id: PaidPlanId;
  name: string;
  /** Dollars. Per vehicle per month when `perVehicle`, else per month. */
  price: number;
  perVehicle: boolean;
  /** AI tokens per day. Resets at UTC midnight. */
  dailyTokens: number;
  /** null = unlimited. On Premium the real cap is the quantity purchased. */
  maxVehicles: number | null;
  blurb: string;
  features: string[];
}

/** How long a new garage gets full Premium access without paying. */
export const TRIAL_DAYS = 14;

/**
 * Plan limits are the product's cost guardrail. AI usage is metered in
 * tokens — the unit the model provider actually bills — because the cost of
 * a question depends on fleet size, not on the question itself.
 *
 * These values must match `ai_token_limit()` and `vehicle_limit_for_org()`
 * in 0012_trial_and_seats.sql. Postgres is the authority: the browser can be
 * edited, the database cannot.
 */
export const PLANS: Record<PaidPlanId, PlanConfig> = {
  pro: {
    id: "pro",
    name: "Premium",
    price: 5,
    perVehicle: true,
    dailyTokens: 30_000,
    maxVehicles: null, // however many are paid for
    blurb: "Pay only for the vehicles you actually track.",
    features: [
      "$5 per vehicle, per month",
      "30,000 AI tokens per day",
      "Add or remove vehicles anytime — the bill follows",
      "Email maintenance reminders",
    ],
  },
  business: {
    id: "business",
    name: "Business",
    price: 20,
    perVehicle: false,
    dailyTokens: 100_000,
    maxVehicles: null,
    blurb: "Unlimited vehicles, one flat price.",
    features: [
      "Unlimited vehicles",
      "100,000 AI tokens per day",
      "AI anomaly predictions",
      "Priority support",
    ],
  },
};

export const PLAN_ORDER: PaidPlanId[] = ["pro", "business"];

/** Monthly cost of a plan at a given fleet size. */
export function monthlyCost(plan: PaidPlanId, vehicles: number): number {
  const cfg = PLANS[plan];
  return cfg.perVehicle ? cfg.price * Math.max(1, vehicles) : cfg.price;
}

/**
 * Premium bills per vehicle, so above a certain fleet size the flat Business
 * price is simply cheaper. Telling people that up front costs a little
 * revenue per customer and buys a lot of trust.
 */
export const BUSINESS_BREAK_EVEN = Math.ceil(
  PLANS.business.price / PLANS.pro.price
);

export function isCheaperOnBusiness(vehicles: number): boolean {
  return monthlyCost("pro", vehicles) > PLANS.business.price;
}

/** Human label for whatever the org is entitled to right now. */
export function planLabel(plan: EffectivePlan): string {
  switch (plan) {
    case "pro":
      return PLANS.pro.name;
    case "business":
      return PLANS.business.name;
    case "trial":
      return "Free trial";
    default:
      return "No plan";
  }
}

/** Whole days left in a trial; 0 once it has run out. */
export function trialDaysLeft(trialEndsAt: string | null): number {
  if (!trialEndsAt) return 0;
  const ms = new Date(trialEndsAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

/** Roughly how many questions a budget buys, for user-facing copy. */
export function approxQuestions(dailyTokens: number): number {
  // A typical question costs ~1,200 tokens: fleet context in, short answer out.
  return Math.max(1, Math.round(dailyTokens / 1200));
}

export function formatTokens(n: number): string {
  return n.toLocaleString("en-US");
}
