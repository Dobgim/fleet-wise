import type { PlanId } from "./types";

export interface PlanConfig {
  id: PlanId;
  name: string;
  pricePerMonth: number;
  /** AI tokens per day. Resets at UTC midnight. */
  dailyTokens: number;
  /** null = unlimited */
  maxVehicles: number | null;
  blurb: string;
  features: string[];
}

/**
 * Plan limits are the product's cost guardrail. AI usage is metered in
 * tokens — the unit the model provider actually bills — because the cost of
 * a question depends on fleet size, not on the question itself. Enforced in
 * Postgres (0005_token_budgets.sql); these values must match
 * `ai_token_limit()` there.
 */
export const PLANS: Record<PlanId, PlanConfig> = {
  free: {
    id: "free",
    name: "Free",
    pricePerMonth: 0,
    dailyTokens: 5_000,
    maxVehicles: 5,
    blurb: "Try the copilot with a small fleet.",
    features: [
      "Up to 5 vehicles",
      "5,000 AI tokens per day",
      "Dashboard & maintenance alerts",
      "Full service history",
    ],
  },
  pro: {
    id: "pro",
    name: "Premium",
    pricePerMonth: 20,
    dailyTokens: 50_000,
    maxVehicles: 50,
    blurb: "For growing fleets that use the AI daily.",
    features: [
      "Up to 50 vehicles",
      "50,000 AI tokens per day",
      "AI anomaly predictions",
      "Email maintenance reminders",
    ],
  },
  business: {
    id: "business",
    name: "Business",
    pricePerMonth: 100,
    dailyTokens: 100_000,
    maxVehicles: null,
    blurb: "Unlimited fleet, all-day copilot.",
    features: [
      "Unlimited vehicles",
      "100,000 AI tokens per day",
      "AI anomaly predictions",
      "Priority support",
    ],
  },
};

export const PLAN_ORDER: PlanId[] = ["free", "pro", "business"];

/** Roughly how many questions a budget buys, for user-facing copy. */
export function approxQuestions(dailyTokens: number): number {
  // A typical question costs ~1,200 tokens: fleet context in, short answer out.
  return Math.max(1, Math.round(dailyTokens / 1200));
}

export function formatTokens(n: number): string {
  return n.toLocaleString("en-US");
}
