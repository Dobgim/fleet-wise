import type { FleetData, ServiceRecord, ServiceType, Vehicle } from "./types";

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function monthsAgo(months: number, day = 15): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  d.setDate(day);
  return iso(d);
}

/**
 * Deterministic demo fleet, dated relative to "today" so the dashboard always
 * has live-looking upcoming/overdue items and an obvious anomaly
 * (TRK-012: three brake jobs in six months).
 */
export function buildSeedData(): FleetData {
  const now = new Date().toISOString();

  const vehicles: Vehicle[] = [
    { id: "v1", registration: "TRK-012", vin: "1FTFW1ET5DFC10312", make: "Ford", model: "F-150", mileage: 148_200, createdAt: now },
    { id: "v2", registration: "VAN-101", vin: "WD3PE7CC5E5831044", make: "Mercedes", model: "Sprinter", mileage: 96_400, createdAt: now },
    { id: "v3", registration: "VAN-102", vin: "WD3PE7CC1F5902113", make: "Mercedes", model: "Sprinter", mileage: 88_750, createdAt: now },
    { id: "v4", registration: "CAR-201", vin: "JTDBR32E720045678", make: "Toyota", model: "Corolla", mileage: 62_300, createdAt: now },
    { id: "v5", registration: "CAR-202", vin: "JTDBR32E720099887", make: "Toyota", model: "Hilux", mileage: 121_900, createdAt: now },
    { id: "v6", registration: "TRK-014", vin: "1FDUF5GT4EEB44821", make: "Ford", model: "F-450", mileage: 173_500, createdAt: now },
  ];

  let i = 0;
  const rec = (
    vehicleId: string,
    type: ServiceType,
    cost: number,
    serviceDate: string,
    notes: string
  ): ServiceRecord => ({
    id: `r${++i}`,
    vehicleId,
    type,
    cost,
    serviceDate,
    notes,
    createdAt: now,
  });

  const records: ServiceRecord[] = [
    // TRK-012 — the problem truck: 3 brake repairs in 6 months + engine work
    rec("v1", "brakes", 420, monthsAgo(6, 3), "Front pads and rotors replaced"),
    rec("v1", "brakes", 310, monthsAgo(3, 21), "Rear pads replaced, caliper sticking"),
    rec("v1", "brakes", 495, monthsAgo(1, 9), "Caliper + hose replaced, pads again"),
    rec("v1", "engine", 1180, monthsAgo(4, 11), "Injector fault, two cylinders replaced"),
    rec("v1", "oil", 85, monthsAgo(5, 27), "Full synthetic + filter"),

    // VAN-101 — normal, oil overdue (last one 8 months ago)
    rec("v2", "oil", 95, monthsAgo(8, 5), "Oil + filter"),
    rec("v2", "tires", 640, monthsAgo(7, 19), "Four new tires"),
    rec("v2", "other", 120, monthsAgo(2, 8), "Wiper motor replaced"),

    // VAN-102 — healthy, oil due soon (~5.5 months ago)
    rec("v3", "oil", 90, monthsAgo(5, 2), "Oil + filter"),
    rec("v3", "brakes", 380, monthsAgo(9, 14), "Front pads"),
    rec("v3", "battery", 210, monthsAgo(12, 6), "New battery"),

    // CAR-201 — light use, all fresh
    rec("v4", "oil", 70, monthsAgo(1, 16), "Oil + filter"),
    rec("v4", "tires", 420, monthsAgo(2, 24), "Two front tires"),

    // CAR-202 — expensive recent engine repair
    rec("v5", "engine", 2350, monthsAgo(2, 12), "Head gasket replacement"),
    rec("v5", "oil", 80, monthsAgo(2, 12), "Oil change with gasket job"),
    rec("v5", "battery", 195, monthsAgo(26, 9), "Battery replaced (overdue again)"),

    // TRK-014 — heavy truck, steady spend
    rec("v6", "oil", 140, monthsAgo(4, 7), "Diesel service"),
    rec("v6", "tires", 1150, monthsAgo(5, 23), "Rear axle tires"),
    rec("v6", "brakes", 610, monthsAgo(10, 3), "Full brake service"),
    rec("v6", "other", 260, monthsAgo(1, 28), "Tail lift hydraulics"),
  ];

  return {
    vehicles,
    records,
    plan: "free",
    aiUsage: { month: new Date().toISOString().slice(0, 7), count: 0 },
  };
}
