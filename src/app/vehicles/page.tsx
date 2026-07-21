"use client";

import Link from "next/link";
import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { formatMoney } from "@/lib/insights";
import { PLANS } from "@/lib/plans";
import { useFleet } from "@/lib/store";
import type { Vehicle } from "@/lib/types";

/** Downscale a photo in the browser before upload — smaller, cheaper, faster. */
function fileToScaledDataUrl(file: File, maxDim = 1200): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("no canvas"));
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.8));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read that image."));
    };
    img.src = url;
  });
}

const EMPTY = { registration: "", vin: "", make: "", model: "", mileage: "" };

export default function VehiclesPage() {
  const {
    ready,
    vehicles,
    records,
    plan,
    canAddVehicle,
    addVehicle,
    updateVehicle,
    deleteVehicle,
    resetDemoData,
    clearAllData,
    applyBudget,
  } = useFleet();
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  if (!ready)
    return <p className="p-8 text-sm text-[var(--text-muted)]">Loading…</p>;

  const startEdit = (v: Vehicle) => {
    setEditingId(v.id);
    setForm({
      registration: v.registration,
      vin: v.vin,
      make: v.make,
      model: v.model,
      mileage: String(v.mileage),
    });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!editingId && !canAddVehicle) {
      setError(
        `The ${PLANS[plan].name} plan is limited to ${PLANS[plan].maxVehicles} vehicles — upgrade to add more.`
      );
      return;
    }
    const mileage = Number(form.mileage);
    if (!form.registration.trim() || !form.make.trim() || !form.model.trim()) {
      setError("Registration, make and model are required.");
      return;
    }
    if (!Number.isFinite(mileage) || mileage < 0) {
      setError("Mileage must be a non-negative number.");
      return;
    }
    const dupe = vehicles.some(
      (v) =>
        v.id !== editingId &&
        v.registration.toLowerCase() === form.registration.trim().toLowerCase()
    );
    if (dupe) {
      setError("A vehicle with that registration already exists.");
      return;
    }
    const payload = {
      registration: form.registration.trim().toUpperCase(),
      vin: form.vin.trim(),
      make: form.make.trim(),
      model: form.model.trim(),
      mileage,
    };
    if (editingId) updateVehicle(editingId, payload);
    else addVehicle(payload);
    setForm(EMPTY);
    setEditingId(null);
    setError("");
  };

  const scanPhoto = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    setError("");
    setScanNote("");
    setScanning(true);
    try {
      const image = await fileToScaledDataUrl(file);
      const res = await fetch("/api/vehicle-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.budget) applyBudget(data.budget);
      if (!res.ok) {
        setError(
          data.message ??
            "Couldn't read that photo. Please fill the form in yourself."
        );
        return;
      }
      // Pre-fill only the fields the AI actually found; keep anything the user
      // already typed for the rest.
      setForm((f) => ({
        registration: data.registration ?? f.registration,
        vin: data.vin ?? f.vin,
        make: data.make ?? f.make,
        model: data.model ?? f.model,
        mileage: data.mileage != null ? String(data.mileage) : f.mileage,
      }));
      const found = ["registration", "make", "model", "vin", "mileage"].filter(
        (k) => data[k] != null && data[k] !== ""
      );
      setScanNote(
        (data.notes ? data.notes + " " : "") +
          (found.length
            ? `Filled in: ${found.join(", ")}. Please check each field, then Add vehicle.`
            : "I couldn't read any details — please fill the form in yourself.")
      );
    } catch {
      setError("Couldn't process that image. Try a clearer, smaller photo.");
    } finally {
      setScanning(false);
    }
  };

  const totalCost = (vehicleId: string) =>
    records
      .filter((r) => r.vehicleId === vehicleId)
      .reduce((s, r) => s + r.cost, 0);

  // text-base on mobile stops iOS Safari from auto-zooming into inputs
  const input =
    "rounded-md border border-neutral-300 bg-transparent px-3 py-1.5 text-base sm:text-sm outline-none focus:border-neutral-500 dark:border-neutral-700";

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 space-y-6 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Vehicles</h1>
        <span className="flex gap-4">
          <button
            onClick={() => {
              if (confirm("Replace all local data with the demo fleet?"))
                resetDemoData();
            }}
            className="text-xs text-[var(--text-muted)] underline-offset-2 hover:underline"
          >
            Load demo data
          </button>
          <button
            onClick={() => {
              if (confirm("Delete ALL vehicles and service records? This cannot be undone."))
                clearAllData();
            }}
            className="text-xs underline-offset-2 hover:underline"
            style={{ color: "var(--status-critical)" }}
          >
            Clear all data
          </button>
        </span>
      </div>

      {!canAddVehicle && !editingId && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          You&apos;ve reached the {PLANS[plan].maxVehicles}-vehicle limit of the{" "}
          {PLANS[plan].name} plan.{" "}
          <Link href="/pricing" className="font-semibold underline">
            Upgrade
          </Link>{" "}
          to add more vehicles.
        </div>
      )}

      <form
        onSubmit={submit}
        className="rounded-xl border border-neutral-200 bg-[var(--surface-1)] p-4 dark:border-neutral-800"
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">
            {editingId ? "Edit vehicle" : "Add vehicle"}
          </h2>
          {!editingId && (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={scanning}
              className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
              style={{ borderColor: "var(--brand)", color: "var(--brand)" }}
            >
              <svg width="15" height="15" viewBox="0 0 20 20" aria-hidden="true" fill="none">
                <path d="M3 7a2 2 0 012-2h1.2l.8-1.4A1 1 0 018 3h4a1 1 0 01.9.6L13.8 5H15a2 2 0 012 2v7a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" stroke="currentColor" strokeWidth="1.5"/>
                <circle cx="10" cy="10.5" r="2.6" stroke="currentColor" strokeWidth="1.5"/>
              </svg>
              {scanning ? "Reading photo…" : "Scan a photo instead"}
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={scanPhoto}
            className="hidden"
          />
        </div>

        {scanNote && (
          <div
            className="mb-3 rounded-lg border px-3 py-2.5 text-sm"
            style={{
              borderColor: "var(--brand)",
              background: "var(--brand-soft)",
            }}
          >
            {scanNote}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-5">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
              Number plate <span style={{ color: "var(--status-critical)" }}>*</span>
            </label>
            <input
              className={input + " w-full"}
              placeholder="e.g. TRK-012"
              value={form.registration}
              onChange={(e) => setForm({ ...form, registration: e.target.value })}
            />
            <p className="mt-1 text-[11px] text-[var(--text-muted)]">
              The plate on the vehicle — how you identify it.
            </p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
              VIN / chassis number
            </label>
            <input
              className={input + " w-full"}
              placeholder="17 characters (optional)"
              value={form.vin}
              onChange={(e) => setForm({ ...form, vin: e.target.value })}
            />
            <p className="mt-1 text-[11px] text-[var(--text-muted)]">
              Found on the registration card or door frame.
            </p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
              Brand <span style={{ color: "var(--status-critical)" }}>*</span>
            </label>
            <input
              className={input + " w-full"}
              placeholder="e.g. Toyota"
              value={form.make}
              onChange={(e) => setForm({ ...form, make: e.target.value })}
            />
            <p className="mt-1 text-[11px] text-[var(--text-muted)]">
              Who made the vehicle.
            </p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
              Model <span style={{ color: "var(--status-critical)" }}>*</span>
            </label>
            <input
              className={input + " w-full"}
              placeholder="e.g. Hilux"
              value={form.model}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
            />
            <p className="mt-1 text-[11px] text-[var(--text-muted)]">
              The vehicle's model name.
            </p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
              Current mileage (km){" "}
              <span style={{ color: "var(--status-critical)" }}>*</span>
            </label>
            <input
              className={input + " w-full"}
              placeholder="e.g. 62300"
              inputMode="numeric"
              value={form.mileage}
              onChange={(e) => setForm({ ...form, mileage: e.target.value })}
            />
            <p className="mt-1 text-[11px] text-[var(--text-muted)]">
              The number on the odometer today.
            </p>
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
            className="rounded-md btn-brand px-4 py-1.5 text-sm font-medium"
          >
            {editingId ? "Save changes" : "Add vehicle"}
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

      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-[var(--surface-1)] dark:border-neutral-800">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-xs text-[var(--text-muted)] dark:border-neutral-800">
              <th className="px-4 py-2.5 font-medium">Registration</th>
              <th className="px-4 py-2.5 font-medium">Make / Model</th>
              <th className="px-4 py-2.5 font-medium">VIN</th>
              <th className="px-4 py-2.5 text-right font-medium">Mileage</th>
              <th className="px-4 py-2.5 text-right font-medium">Total cost</th>
              <th className="px-4 py-2.5 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {vehicles.map((v) => (
              <tr key={v.id}>
                <td className="px-4 py-2.5">
                  <Link
                    href={`/vehicles/${v.id}`}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    {v.registration}
                  </Link>
                </td>
                <td className="px-4 py-2.5">
                  {v.make} {v.model}
                </td>
                <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-secondary)]">
                  {v.vin || "—"}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {v.mileage.toLocaleString()} km
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {formatMoney(totalCost(v.id))}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Link
                    href={`/vehicles/${v.id}`}
                    className="mr-3 text-xs font-medium underline-offset-2 hover:underline"
                    style={{ color: "var(--brand)" }}
                  >
                    Log service
                  </Link>
                  <button
                    onClick={() => startEdit(v)}
                    className="mr-3 text-xs underline-offset-2 hover:underline"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`Delete ${v.registration} and its records?`))
                        deleteVehicle(v.id);
                    }}
                    className="text-xs underline-offset-2 hover:underline"
                    style={{ color: "var(--status-critical)" }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {vehicles.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-8 text-center text-[var(--text-muted)]"
                >
                  No vehicles yet — add your first one above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
