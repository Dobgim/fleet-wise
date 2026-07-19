import {
  SERVICE_INTERVAL_MONTHS,
  SERVICE_TYPE_LABELS,
  type ServiceRecord,
  type ServiceType,
  type Vehicle,
} from "./types";

export interface MaintenanceItem {
  vehicle: Vehicle;
  type: ServiceType;
  lastDate: string;
  dueDate: string;
  status: "overdue" | "upcoming"; // upcoming = due within 30 days
  daysDiff: number; // days overdue (positive) or days until due (positive)
}

export interface Anomaly {
  vehicleId: string;
  registration: string;
  severity: "warning" | "critical";
  message: string;
}

export interface MonthCost {
  month: string; // YYYY-MM
  label: string; // "Feb"
  total: number;
}

const DAY = 86_400_000;

function addMonths(dateIso: string, months: number): Date {
  const d = new Date(dateIso);
  d.setMonth(d.getMonth() + months);
  return d;
}

export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function formatMoney(n: number): string {
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

/** Latest service record per (vehicle, type). */
function lastServiceMap(records: ServiceRecord[]): Map<string, ServiceRecord> {
  const map = new Map<string, ServiceRecord>();
  for (const r of records) {
    const key = `${r.vehicleId}:${r.type}`;
    const prev = map.get(key);
    if (!prev || r.serviceDate > prev.serviceDate) map.set(key, r);
  }
  return map;
}

/**
 * Interval-based schedule: a service type is due `interval` months after the
 * vehicle's last record of that type. Overdue = past due date; upcoming = due
 * within the next 30 days.
 */
export function getMaintenanceItems(
  vehicles: Vehicle[],
  records: ServiceRecord[]
): MaintenanceItem[] {
  const last = lastServiceMap(records);
  const today = new Date();
  const items: MaintenanceItem[] = [];

  for (const vehicle of vehicles) {
    for (const [type, interval] of Object.entries(SERVICE_INTERVAL_MONTHS) as [
      ServiceType,
      number | null,
    ][]) {
      if (interval === null) continue;
      const lastRec = last.get(`${vehicle.id}:${type}`);
      if (!lastRec) continue; // no history — nothing to schedule from
      const due = addMonths(lastRec.serviceDate, interval);
      const diffDays = Math.round((due.getTime() - today.getTime()) / DAY);
      if (diffDays < 0) {
        items.push({
          vehicle,
          type,
          lastDate: lastRec.serviceDate,
          dueDate: due.toISOString().slice(0, 10),
          status: "overdue",
          daysDiff: -diffDays,
        });
      } else if (diffDays <= 30) {
        items.push({
          vehicle,
          type,
          lastDate: lastRec.serviceDate,
          dueDate: due.toISOString().slice(0, 10),
          status: "upcoming",
          daysDiff: diffDays,
        });
      }
    }
  }

  return items.sort((a, b) =>
    a.status === b.status
      ? b.daysDiff - a.daysDiff
      : a.status === "overdue"
        ? -1
        : 1
  );
}

/** Total cost per month for the last `n` months, oldest first. */
export function getMonthlyCosts(records: ServiceRecord[], n = 6): MonthCost[] {
  const out: MonthCost[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = monthKey(d);
    out.push({
      month: key,
      label: d.toLocaleString("en-US", { month: "short" }),
      total: records
        .filter((r) => r.serviceDate.startsWith(key))
        .reduce((s, r) => s + r.cost, 0),
    });
  }
  return out;
}

export function getTopVehiclesByCost(
  vehicles: Vehicle[],
  records: ServiceRecord[],
  sinceMonths = 6,
  limit = 5
): { vehicle: Vehicle; total: number }[] {
  const cutoff = addMonths(new Date().toISOString().slice(0, 10), -sinceMonths)
    .toISOString()
    .slice(0, 10);
  return vehicles
    .map((vehicle) => ({
      vehicle,
      total: records
        .filter((r) => r.vehicleId === vehicle.id && r.serviceDate >= cutoff)
        .reduce((s, r) => s + r.cost, 0),
    }))
    .filter((x) => x.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

/**
 * Rule-based anomaly detection (the LLM replaces the phrasing later, not the
 * rules): repeat repairs of one type, and outlier spend vs the fleet.
 */
export function detectAnomalies(
  vehicles: Vehicle[],
  records: ServiceRecord[]
): Anomaly[] {
  const anomalies: Anomaly[] = [];
  const sixMonthsAgo = addMonths(new Date().toISOString().slice(0, 10), -6)
    .toISOString()
    .slice(0, 10);

  for (const vehicle of vehicles) {
    const recent = records.filter(
      (r) => r.vehicleId === vehicle.id && r.serviceDate >= sixMonthsAgo
    );

    // Repeat repairs of the same type
    const byType = new Map<ServiceType, number>();
    for (const r of recent) byType.set(r.type, (byType.get(r.type) ?? 0) + 1);
    for (const [type, count] of byType) {
      if (type !== "oil" && count >= 3) {
        anomalies.push({
          vehicleId: vehicle.id,
          registration: vehicle.registration,
          severity: "critical",
          message: `${vehicle.registration} had ${count} ${SERVICE_TYPE_LABELS[type].toLowerCase()} repairs in 6 months — abnormal, inspect for a root cause.`,
        });
      }
    }
  }

  // Outlier spend: > 2x fleet average over the last 6 months
  const totals = vehicles.map((v) => ({
    v,
    total: records
      .filter((r) => r.vehicleId === v.id && r.serviceDate >= sixMonthsAgo)
      .reduce((s, r) => s + r.cost, 0),
  }));
  const avg =
    totals.reduce((s, t) => s + t.total, 0) / Math.max(totals.length, 1);
  for (const { v, total } of totals) {
    if (avg > 0 && total > 2 * avg) {
      anomalies.push({
        vehicleId: v.id,
        registration: v.registration,
        severity: "warning",
        message: `${v.registration} cost ${formatMoney(total)} in the last 6 months — more than double the fleet average of ${formatMoney(Math.round(avg))}.`,
      });
    }
  }

  return anomalies;
}
