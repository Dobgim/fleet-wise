"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { detectAnomalies, formatMoney, getMaintenanceItems } from "@/lib/insights";
import { useFleet } from "@/lib/store";
import {
  SERVICE_TYPES,
  SERVICE_TYPE_LABELS,
  type ServiceType,
} from "@/lib/types";

const EMPTY = {
  type: "oil" as ServiceType,
  cost: "",
  serviceDate: new Date().toISOString().slice(0, 10),
  notes: "",
};

export default function VehicleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { ready, vehicles, records, addRecord, updateRecord, deleteRecord, deleteVehicle } =
    useFleet();
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  if (!ready)
    return <p className="p-8 text-sm text-[var(--text-muted)]">Loading…</p>;

  const vehicle = vehicles.find((v) => v.id === id);
  if (!vehicle)
    return (
      <main className="mx-auto w-full max-w-4xl flex-1 p-6">
        <p className="text-sm">
          Vehicle not found.{" "}
          <Link href="/vehicles" className="underline">
            Back to vehicles
          </Link>
        </p>
      </main>
    );

  const history = records
    .filter((r) => r.vehicleId === vehicle.id)
    .sort((a, b) => b.serviceDate.localeCompare(a.serviceDate));
  const total = history.reduce((s, r) => s + r.cost, 0);
  const due = getMaintenanceItems([vehicle], records);
  const anomalies = detectAnomalies([vehicle], records).filter(
    (a) => a.vehicleId === vehicle.id
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const cost = Number(form.cost);
    if (!Number.isFinite(cost) || cost < 0) {
      setError("Cost must be a non-negative number.");
      return;
    }
    if (!form.serviceDate) {
      setError("Service date is required.");
      return;
    }
    const payload = {
      vehicleId: vehicle.id,
      type: form.type,
      cost,
      serviceDate: form.serviceDate,
      notes: form.notes.trim(),
    };
    if (editingId) updateRecord(editingId, payload);
    else addRecord(payload);
    setForm(EMPTY);
    setEditingId(null);
    setError("");
  };

  const input =
    "rounded-md border border-neutral-300 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700";

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 space-y-6 p-4 sm:p-6">
      <div>
        <Link href="/vehicles" className="text-xs text-[var(--text-muted)] hover:underline">
          ← All vehicles
        </Link>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-bold tracking-tight">
            {vehicle.registration}{" "}
            <span className="font-normal text-[var(--text-secondary)]">
              · {vehicle.make} {vehicle.model}
            </span>
          </h1>
          <button
            onClick={() => {
              if (confirm(`Delete ${vehicle.registration} and its records?`)) {
                deleteVehicle(vehicle.id);
                router.push("/vehicles");
              }
            }}
            className="text-xs underline-offset-2 hover:underline"
            style={{ color: "var(--status-critical)" }}
          >
            Delete vehicle
          </button>
        </div>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          {vehicle.mileage.toLocaleString()} km
          {vehicle.vin && (
            <>
              {" · VIN "}
              <span className="font-mono text-xs">{vehicle.vin}</span>
            </>
          )}
          {" · "}
          {history.length} records · {formatMoney(total)} total
        </p>
      </div>

      {(anomalies.length > 0 || due.length > 0) && (
        <section className="rounded-xl border border-neutral-200 bg-[var(--surface-1)] p-4 dark:border-neutral-800">
          <h2 className="mb-2 text-sm font-semibold">Health</h2>
          <ul className="space-y-1.5 text-sm">
            {anomalies.map((a, i) => (
              <li key={`a${i}`} className="flex items-start gap-2">
                <span
                  className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                  style={{
                    background:
                      a.severity === "critical"
                        ? "var(--status-critical)"
                        : "var(--status-serious)",
                  }}
                />
                {a.message}
              </li>
            ))}
            {due.map((it, i) => (
              <li key={`d${i}`} className="flex items-start gap-2">
                <span
                  className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                  style={{
                    background:
                      it.status === "overdue"
                        ? "var(--status-critical)"
                        : "var(--status-warning)",
                  }}
                />
                {SERVICE_TYPE_LABELS[it.type]}{" "}
                {it.status === "overdue"
                  ? `overdue by ${it.daysDiff} days (was due ${it.dueDate})`
                  : `due in ${it.daysDiff} days (${it.dueDate})`}
              </li>
            ))}
          </ul>
        </section>
      )}

      <form
        onSubmit={submit}
        className="rounded-xl border border-neutral-200 bg-[var(--surface-1)] p-4 dark:border-neutral-800"
      >
        <h2 className="mb-3 text-sm font-semibold">
          {editingId ? "Edit service record" : "Log a service"}
        </h2>
        <div className="grid gap-3 sm:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
              What was done{" "}
              <span style={{ color: "var(--status-critical)" }}>*</span>
            </label>
            <select
              className={input + " w-full"}
              value={form.type}
              onChange={(e) =>
                setForm({ ...form, type: e.target.value as ServiceType })
              }
            >
              {SERVICE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {SERVICE_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
              Amount paid ($){" "}
              <span style={{ color: "var(--status-critical)" }}>*</span>
            </label>
            <input
              className={input + " w-full"}
              placeholder="e.g. 150"
              inputMode="decimal"
              value={form.cost}
              onChange={(e) => setForm({ ...form, cost: e.target.value })}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
              Date of service{" "}
              <span style={{ color: "var(--status-critical)" }}>*</span>
            </label>
            <input
              className={input + " w-full"}
              type="date"
              value={form.serviceDate}
              onChange={(e) => setForm({ ...form, serviceDate: e.target.value })}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
              Notes (optional)
            </label>
            <input
              className={input + " w-full"}
              placeholder="e.g. Front pads replaced"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
        </div>
        {error && (
          <p className="mt-2 text-sm" style={{ color: "var(--status-critical)" }}>
            {error}
          </p>
        )}
        <div className="mt-3 flex gap-2">
          <button
            type="submit"
            className="rounded-md bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            {editingId ? "Save changes" : "Add record"}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={() => {
                setEditingId(null);
                setForm(EMPTY);
                setError("");
              }}
              className="rounded-md border border-neutral-300 px-4 py-1.5 text-sm dark:border-neutral-700"
            >
              Cancel
            </button>
          )}
        </div>
      </form>

      <section className="overflow-x-auto rounded-xl border border-neutral-200 bg-[var(--surface-1)] dark:border-neutral-800">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-xs text-[var(--text-muted)] dark:border-neutral-800">
              <th className="px-4 py-2.5 font-medium">Date</th>
              <th className="px-4 py-2.5 font-medium">Type</th>
              <th className="px-4 py-2.5 text-right font-medium">Cost</th>
              <th className="px-4 py-2.5 font-medium">Notes</th>
              <th className="px-4 py-2.5 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {history.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-2.5 tabular-nums">{r.serviceDate}</td>
                <td className="px-4 py-2.5">{SERVICE_TYPE_LABELS[r.type]}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {formatMoney(r.cost)}
                </td>
                <td className="px-4 py-2.5 text-[var(--text-secondary)]">
                  {r.notes || "—"}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <button
                    onClick={() => {
                      setEditingId(r.id);
                      setForm({
                        type: r.type,
                        cost: String(r.cost),
                        serviceDate: r.serviceDate,
                        notes: r.notes,
                      });
                    }}
                    className="mr-3 text-xs underline-offset-2 hover:underline"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => {
                      if (confirm("Delete this service record?")) deleteRecord(r.id);
                    }}
                    className="text-xs underline-offset-2 hover:underline"
                    style={{ color: "var(--status-critical)" }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {history.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-[var(--text-muted)]"
                >
                  No service records yet — log the first one above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}
