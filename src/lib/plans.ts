import type { EffectivePlan, PlanId } from "./types";

/** Plans that can be bought. "free" is the default and costs nothing. */
export type PaidPlanId = Extract<PlanId, "pro" | "business">;

export interface PlanConfig {
  id: PaidPlanId;
  name: string;
  /** Dollars. Per billable vehicle per month when `perVehicle`, else flat. */
  price: number;
  perVehicle: boolean;
  blurb: string;
  features: string[];
}

/**
 * Vehicles included at no charge, on every plan. A Premium customer with five
 * vehicles pays for two.
 *
 * Must match `free_vehicles()` in 0013_per_vehicle_pricing.sql. Postgres is
 * the authority: the browser can be edited, the database cannot.
 */
export const FREE_VEHICLES = 3;

/**
 * Pricing follows the category: per vehicle, per month. AI usage is metered
 * internally as a fair-use backstop but is never quoted as a number — "3,000
 * tokens a day" means nothing to a fleet manager and makes a business tool
 * read as a tech demo.
 */
export const PLANS: Record<PaidPlanId, PlanConfig> = {
  pro: {
    id: "pro",
    name: "Premium",
    price: 5,
    perVehicle: true,
    blurb: "Grow past three vehicles. Pay only for the extras.",
    features: [
      `First ${FREE_VEHICLES} vehicles free, then $5 per vehicle per month`,
      "AI predictive maintenance across your whole fleet",
      "Email reminders 7 days and 3 days before each service",
      "Add or remove vehicles anytime — no contract, cancel in one click",
    ],
  },
  business: {
    id: "business",
    name: "Business",
    price: 20,
    perVehicle: false,
    blurb: "Flat rate for larger fleets.",
    features: [
      "Unlimited vehicles, one price",
      "AI predictive maintenance across your whole fleet",
      "Priority support",
      "No contract, cancel anytime",
    ],
  },
};

export const PLAN_ORDER: PaidPlanId[] = ["pro", "business"];

/** Vehicles actually charged for: everything past the free allowance. */
export function billableVehicles(total: number): number {
  return Math.max(0, total - FREE_VEHICLES);
}

/** Monthly cost of a plan at a given fleet size. */
export function monthlyCost(plan: PaidPlanId, vehicles: number): number {
  const cfg = PLANS[plan];
  return cfg.perVehicle ? cfg.price * billableVehicles(vehicles) : cfg.price;
}

/** Fleet size at which the flat Business price beats paying per vehicle. */
export const BUSINESS_BREAK_EVEN =
  FREE_VEHICLES + Math.ceil(PLANS.business.price / PLANS.pro.price);

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
    default:
      return "Free";
  }
}

export function formatTokens(n: number): string {
  return n.toLocaleString("en-US");
}
