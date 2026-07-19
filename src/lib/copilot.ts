import {
  detectAnomalies,
  formatMoney,
  getMaintenanceItems,
  getMonthlyCosts,
  getTopVehiclesByCost,
  monthKey,
} from "./insights";
import {
  SERVICE_INTERVAL_MONTHS,
  SERVICE_TYPE_LABELS,
  type FleetData,
  type Vehicle,
} from "./types";

/**
 * Local-mode copilot: rule-based answers grounded only in the org's data.
 * Same contract the LLM-backed askCopilot(orgId, question) will implement in
 * step 7 — the chat UI won't change, only this module.
 */

function findVehicle(question: string, vehicles: Vehicle[]): Vehicle | null {
  const q = question.toLowerCase();
  return (
    vehicles.find((v) => q.includes(v.registration.toLowerCase())) ??
    vehicles.find((v) => q.includes(v.model.toLowerCase())) ??
    null
  );
}

type CopilotData = Pick<FleetData, "vehicles" | "records">;

function vehicleHistory(vehicle: Vehicle, data: CopilotData): string {
  const recs = data.records
    .filter((r) => r.vehicleId === vehicle.id)
    .sort((a, b) => a.serviceDate.localeCompare(b.serviceDate));
  if (recs.length === 0)
    return `${vehicle.registration} (${vehicle.make} ${vehicle.model}) has no service records yet.`;

  const total = recs.reduce((s, r) => s + r.cost, 0);
  const lines = recs.map(
    (r) =>
      `• ${r.serviceDate} — ${SERVICE_TYPE_LABELS[r.type]}, ${formatMoney(r.cost)}${r.notes ? ` (${r.notes})` : ""}`
  );
  return [
    `${vehicle.registration} is a ${vehicle.make} ${vehicle.model} with ${vehicle.mileage.toLocaleString()} km on the clock. It has ${recs.length} service records totalling ${formatMoney(total)}:`,
    ...lines,
  ].join("\n");
}

export function askCopilot(question: string, data: CopilotData): string {
  const q = question.toLowerCase();
  const { vehicles, records } = data;

  if (vehicles.length === 0)
    return "You have no vehicles yet. Add one on the Vehicles page and I can start answering questions about your fleet.";

  // Predict next oil change
  if (q.includes("oil")) {
    const vehicle = findVehicle(q, vehicles);
    const targets = vehicle ? [vehicle] : vehicles;
    const lines = targets.map((v) => {
      const last = records
        .filter((r) => r.vehicleId === v.id && r.type === "oil")
        .sort((a, b) => b.serviceDate.localeCompare(a.serviceDate))[0];
      if (!last)
        return `• ${v.registration}: no oil change on record, so I can't predict the next one.`;
      const due = new Date(last.serviceDate);
      due.setMonth(due.getMonth() + (SERVICE_INTERVAL_MONTHS.oil ?? 6));
      const dueStr = due.toISOString().slice(0, 10);
      const overdue = due < new Date();
      return `• ${v.registration}: last oil change ${last.serviceDate}, next due ~${dueStr}${overdue ? " — already overdue" : ""}.`;
    });
    return ["Based on a 6-month oil change interval:", ...lines].join("\n");
  }

  // Servicing due (this month / this week / due / overdue)
  if (/\b(due|servic|overdue|maintenance|this month|this week)\b/.test(q)) {
    const items = getMaintenanceItems(vehicles, records);
    if (items.length === 0)
      return "Nothing is overdue or due in the next 30 days. Your fleet is up to date.";
    const lines = items.map((it) =>
      it.status === "overdue"
        ? `• ${it.vehicle.registration} — ${SERVICE_TYPE_LABELS[it.type]} OVERDUE by ${it.daysDiff} days (was due ${it.dueDate})`
        : `• ${it.vehicle.registration} — ${SERVICE_TYPE_LABELS[it.type]} due in ${it.daysDiff} days (${it.dueDate})`
    );
    return ["Here's what needs servicing:", ...lines].join("\n");
  }

  // Cost questions
  if (/\b(cost|expensive|spend|spent|money)\b/.test(q)) {
    const top = getTopVehiclesByCost(vehicles, records, 6);
    if (top.length === 0)
      return "No service costs recorded in the last 6 months.";
    const lines = top.map(
      ({ vehicle, total }, idx) =>
        `${idx + 1}. ${vehicle.registration} (${vehicle.make} ${vehicle.model}) — ${formatMoney(total)}`
    );
    return ["Top vehicles by maintenance cost over the last 6 months:", ...lines].join("\n");
  }

  // Reliability
  if (/\b(unreliable|reliab|breaking|problem|worst)\b/.test(q)) {
    const anomalies = detectAnomalies(vehicles, records);
    if (anomalies.length === 0)
      return "No vehicle shows an abnormal repair pattern right now.";
    return [
      "These vehicles are showing signs of becoming unreliable:",
      ...anomalies.map((a) => `• ${a.message}`),
    ].join("\n");
  }

  // Duplicate repairs
  if (/\b(duplicate|repeat|again|twice)\b/.test(q)) {
    const dupes: string[] = [];
    for (const v of vehicles) {
      const byType = new Map<string, number>();
      for (const r of records.filter((r) => r.vehicleId === v.id))
        byType.set(r.type, (byType.get(r.type) ?? 0) + 1);
      for (const [type, count] of byType)
        if (count >= 2 && type !== "oil")
          dupes.push(
            `• ${v.registration}: ${count}× ${SERVICE_TYPE_LABELS[type as keyof typeof SERVICE_TYPE_LABELS].toLowerCase()}`
          );
    }
    return dupes.length
      ? ["Repeated repairs on record (excluding routine oil changes):", ...dupes].join("\n")
      : "No duplicate repairs found in your records.";
  }

  // Summarize last month
  if (/\b(summar|last month|report)\b/.test(q)) {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    const key = monthKey(d);
    const monthRecs = records.filter((r) => r.serviceDate.startsWith(key));
    if (monthRecs.length === 0)
      return `No service records were logged last month (${key}).`;
    const total = monthRecs.reduce((s, r) => s + r.cost, 0);
    const lines = monthRecs.map((r) => {
      const v = vehicles.find((v) => v.id === r.vehicleId);
      return `• ${r.serviceDate} — ${v?.registration ?? "?"}: ${SERVICE_TYPE_LABELS[r.type]}, ${formatMoney(r.cost)}`;
    });
    return [
      `Last month (${key}) you logged ${monthRecs.length} services totalling ${formatMoney(total)}:`,
      ...lines,
    ].join("\n");
  }

  // Preventive maintenance suggestions
  if (/\b(prevent|suggest|recommend|advice)\b/.test(q)) {
    const items = getMaintenanceItems(vehicles, records);
    const anomalies = detectAnomalies(vehicles, records);
    const lines = [
      ...items
        .filter((i) => i.status === "upcoming")
        .map(
          (i) =>
            `• Book ${SERVICE_TYPE_LABELS[i.type].toLowerCase()} for ${i.vehicle.registration} before ${i.dueDate} to avoid it going overdue.`
        ),
      ...anomalies.map((a) => `• ${a.message}`),
    ];
    return lines.length
      ? ["Preventive maintenance suggestions:", ...lines].join("\n")
      : "Nothing preventive to suggest right now — the fleet looks healthy.";
  }

  // Vehicle history ("tell me about VAN-101")
  const vehicle = findVehicle(q, vehicles);
  if (vehicle) return vehicleHistory(vehicle, data);

  // Fleet overview fallback
  const monthly = getMonthlyCosts(records, 6);
  const total6 = monthly.reduce((s, m) => s + m.total, 0);
  return [
    "I can answer questions about servicing due, costs, reliability, oil changes, duplicate repairs, last month's summary, preventive maintenance, or a specific vehicle (mention its registration).",
    `Quick overview: ${vehicles.length} vehicles, ${records.length} service records, ${formatMoney(total6)} spent in the last 6 months.`,
  ].join("\n");
}
