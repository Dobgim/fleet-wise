import type { EffectivePlan, PlanId } from "./types";

/** Plans that can be bought. "free" is the default and costs nothing. */
export type PaidPlanId = Extract<PlanId, "pro" | "business" | "yearly">;

export interface PlanConfig {
  id: PaidPlanId;
  name: string;
  /** Dollars. Per billable vehicle when `perVehicle`, else flat per period. */
  price: number;
  perVehicle: boolean;
  /** Billing period in days. Whop takes days, not a period name. */
  billingDays: number;
  /** "month" | "year" — what the price is quoted per. */
  per: "month" | "year";
  /** Vehicles included. null means it is priced per vehicle instead. */
  vehicles: number | null;
  blurb: string;
  features: string[];
}

/**
 * Vehicles included at no charge once billing is live. A Premium customer
 * with five vehicles pays for three.
 *
 * Must match the non-beta branch of `free_vehicles()` in 0015. Postgres is
 * the authority: the browser can be edited, the database cannot.
 */
// Typed as number, not the literal 2: the singular/plural copy branches on
// this value, and a literal type makes TypeScript reject those comparisons.
export const FREE_VEHICLES: number = 2;

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
    billingDays: 30,
    per: "month",
    vehicles: null,
    blurb: "Grow past two vehicles. Pay only for the extras.",
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
    price: 18,
    perVehicle: false,
    billingDays: 30,
    per: "month",
    vehicles: 20,
    blurb: "Flat rate for larger fleets.",
    features: [
      "Up to 20 vehicles, one price",
      "5 photo scans a day",
      "AI predictive maintenance across your whole fleet",
      "Priority support",
      "No contract, cancel anytime",
    ],
  },
  yearly: {
    id: "yearly",
    name: "Business Yearly",
    price: 199,
    perVehicle: false,
    billingDays: 365,
    per: "year",
    vehicles: 50,
    blurb: "Pay once a year. More vehicles, more scans, less admin.",
    features: [
      "Up to 50 vehicles, one price",
      "10 photo scans a day",
      "AI predictive maintenance across your whole fleet",
      "Priority support",
      "Cancel anytime — no auto-renew surprises",
    ],
  },
};

/**
 * Vehicles included on the flat plans. Stated caps rather than "unlimited":
 * a flat fee covering a 300-vehicle fleet costs real money in AI calls and
 * reminder emails while paying the same as a fleet of six. Must match
 * `vehicle_limit_for_org()` in migration 0020.
 */
export const BUSINESS_VEHICLES = 20;
export const YEARLY_VEHICLES = 50;

export const PLAN_ORDER: PaidPlanId[] = ["pro", "business", "yearly"];

/**
 * Photo scans allowed per day, by plan.
 *
 * Vision is the most expensive call the product makes — roughly five times a
 * chat question — so it is the one AI feature that is paid-only. Must match
 * `scan_limit_for_plan()` in migration 0018; Postgres enforces it, this is
 * only what the interface says.
 */
export const SCAN_LIMITS: Record<EffectivePlan, number> = {
  free: 0,
  pro: 3,
  business: 5,
  yearly: 10,
};

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
  // Cheaper is not the same as available: past the cap, Business cannot hold
  // the fleet at all, and recommending it there would send someone to a plan
  // that refuses their 21st vehicle.
  return (
    vehicles <= BUSINESS_VEHICLES &&
    monthlyCost("pro", vehicles) > PLANS.business.price
  );
}

/** True when a fleet is too large for a given flat plan to cover. */
export function exceedsPlan(id: PaidPlanId, vehicles: number): boolean {
  const cap = PLANS[id].vehicles;
  return cap !== null && vehicles > cap;
}

/** Human label for whatever the org is entitled to right now. */
export function planLabel(plan: EffectivePlan): string {
  switch (plan) {
    case "pro":
      return PLANS.pro.name;
    case "business":
      return PLANS.business.name;
    case "yearly":
      return PLANS.yearly.name;
    default:
      return "Free";
  }
}

export function formatTokens(n: number): string {
  return n.toLocaleString("en-US");
}
