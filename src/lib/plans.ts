import type { PlanId } from "./types";

export interface PlanConfig {
  id: PlanId;
  name: string;
  pricePerMonth: number;
  /** null = unlimited */
  aiQuestionsPerMonth: number | null;
  /** null = unlimited */
  maxVehicles: number | null;
  blurb: string;
  features: string[];
}

/**
 * Plan limits are the product's token-cost guardrail: each AI question spends
 * LLM tokens, so the free tier gets a small monthly allowance and paid tiers
 * buy more. Enforced in the app now; re-enforced server-side when Supabase +
 * Stripe are connected.
 */
export const PLANS: Record<PlanId, PlanConfig> = {
  free: {
    id: "free",
    name: "Free",
    pricePerMonth: 0,
    aiQuestionsPerMonth: 10,
    maxVehicles: 5,
    blurb: "Try the copilot with a small fleet.",
    features: [
      "Up to 5 vehicles",
      "10 AI questions per month",
      "Dashboard & maintenance alerts",
      "Full service history",
    ],
  },
  pro: {
    id: "pro",
    name: "Premium",
    pricePerMonth: 20,
    aiQuestionsPerMonth: 200,
    maxVehicles: 50,
    blurb: "For growing fleets that use the AI daily.",
    features: [
      "Up to 50 vehicles",
      "200 AI questions per month",
      "AI anomaly predictions",
      "Email maintenance reminders (soon)",
    ],
  },
  business: {
    id: "business",
    name: "Business",
    pricePerMonth: 100,
    aiQuestionsPerMonth: null,
    maxVehicles: null,
    blurb: "Unlimited fleet, unlimited copilot.",
    features: [
      "Unlimited vehicles",
      "Unlimited AI questions",
      "AI anomaly predictions",
      "Priority support",
    ],
  },
};

export const PLAN_ORDER: PlanId[] = ["free", "pro", "business"];
