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

export type PlanId = "free" | "pro" | "business";

export interface AiUsage {
  month: string; // YYYY-MM the counter applies to
  count: number;
}

export interface FleetData {
  vehicles: Vehicle[];
  records: ServiceRecord[];
  plan: PlanId;
  aiUsage: AiUsage;
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
