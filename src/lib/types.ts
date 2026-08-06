export const SERVICE_TYPES = [
  "oil",
  "brakes",
  "tires",
  "battery",
  "engine",
  "other",
] as const;

export type ServiceType = (typeof SERVICE_TYPES)[number];

export interface Vehicle {
  id: string;
  registration: string;
  vin: string;
  make: string;
  model: string;
  mileage: number;
  createdAt: string; // ISO
}

export interface ServiceRecord {
  id: string;
  vehicleId: string;
  type: ServiceType;
  cost: number;
  serviceDate: string; // ISO date (YYYY-MM-DD)
  notes: string;
  createdAt: string; // ISO
}

/**
 * What is stored in `organizations.plan`. "free" is no longer a product —
 * it means "not subscribed", which during the trial window still grants
 * Premium-level access.
 */
export type PlanId = "free" | "pro" | "business";

/**
 * What the organization is entitled to right now, decided by Postgres in
 * `effective_plan()`. This — not PlanId — is what the UI should reason about.
 */
export type EffectivePlan = "free" | "pro" | "business";

/** Today's AI token budget for an organization, as reported by Postgres. */
export interface AiBudget {
  limit: number;
  used: number;
  remaining: number;
  requests: number;
  /** ISO timestamp of the next UTC midnight, when the budget refills. */
  resets_at: string;
  /** Entitlement in force. */
  plan: EffectivePlan;
  /** Total vehicles allowed. */
  vehicleLimit: number | null;
  /** Vehicles included at no charge on every plan. */
  freeVehicles: number;
  /** Premium only: vehicles paid for, i.e. beyond the free allowance. */
  seats: number | null;
  /** Photo scans allowed per day on this plan. 0 means the plan has none. */
  scanLimit: number;
  scansUsed: number;
  scansRemaining: number;
}

export interface FleetData {
  vehicles: Vehicle[];
  records: ServiceRecord[];
  plan: PlanId;
}

export const SERVICE_TYPE_LABELS: Record<ServiceType, string> = {
  oil: "Oil change",
  brakes: "Brakes",
  tires: "Tires",
  battery: "Battery",
  engine: "Engine",
  other: "Other",
};

/** Recommended service intervals in months (null = no fixed schedule). */
export const SERVICE_INTERVAL_MONTHS: Record<ServiceType, number | null> = {
  oil: 6,
  brakes: 12,
  tires: 12,
  battery: 24,
  engine: null,
  other: null,
};
