"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { formatMoney } from "@/lib/insights";
import {
  billableVehicles,
  FREE_VEHICLES,
  monthlyCost,
  PLANS,
  SCAN_LIMITS,
} from "@/lib/plans";
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

/** Photos of the same vehicle allowed in one scan. Matches MAX_IMAGES on the API. */
const MAX_SCAN_IMAGES = 5;

export default function VehiclesPage() {
  const {
    ready,
    vehicles,
    records,
    budget,
    canAddVehicle,
    refreshOrg,
    addVehicle,
    updateVehicle,
    deleteVehicle,
    resetDemoData,
    clearAllData,
    applyBudget,
  } = useFleet();
  const router = useRouter();
  const [form, setForm] = useState(EMPTY);
  const [seatBusy, setSeatBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [scanning, setScanning] = useState(false);
  // Shown instead of the file picker when the plan has no scans at all. The
  // upgrade prompt IS the free-tier experience of this feature, so it has to
  // explain what is behind the wall rather than just refuse.
  const [scanUpsell, setScanUpsell] = useState(false);
  // A rejected scan has to be told apart from a successful one at a glance,
  // so the banner carries its tone rather than the page inferring it.
  const [scanNote, setScanNote] = useState<{
    text: string;
    tone: "info" | "reject";
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!ready)
    return <p className="p-8 text-sm text-[var(--text-muted)]">Loading…</p>;

  // Postgres decides both of these; these copies only shape the button, and
  // the server refuses independently if they are ever wrong.
  const remindersOn = vehicles.filter((v) => v.remindersEnabled).length;
  const reminderCap = budget.vehicleLimit ?? vehicles.length;
  const remindersFull = remindersOn >= reminderCap;
  // A downgrade leaves more vehicles selected than the new plan covers. The
  // extras are silently skipped by the cron until the owner chooses, so this
  // has to say so rather than let reminders quietly stop.
  const remindersOverCap = remindersOn > reminderCap;

  const canScan = budget.scanLimit > 0;
  const outOfScans = canScan && budget.scansRemaining <= 0;

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

  /**
   * Buy one more vehicle on Premium.
   *
   * Whop cannot change the price of a running subscription — it has no
   * quantity — so growing the plan means checking out a replacement priced
   * for the larger fleet. The webhook cancels the subscription it supersedes
   * the moment the new one activates, so nobody is billed twice.
   */
  const addSeat = async () => {
    setError("");

    // seats counts vehicles PAID FOR, i.e. beyond the free allowance.
    const paidFor = budget.seats ?? billableVehicles(vehicles.length);
    const fleet = FREE_VEHICLES + paidFor + 1;
    const cost = monthlyCost("pro", fleet);

    if (
      !window.confirm(
        `Add one vehicle to your plan?\n\nYour subscription becomes $${cost}/month for ${paidFor + 1} paid vehicle${paidFor + 1 === 1 ? "" : "s"}. Your current subscription is cancelled automatically once the new one starts, so you are never charged twice.`
      )
    )
      return;

    setSeatBusy(true);
    try {
      const res = await fetch("/api/whop/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: "pro", fleet }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.sessionId) {
        setError(data.error ?? "Couldn't start checkout. Please try again.");
        return;
      }
      const query = new URLSearchParams({ session: data.sessionId });
      if (data.planId) query.set("plan", data.planId);
      // The embed defaults to production; a sandbox session without this
      // renders Whop's 404 page inside the payment box.
      if (data.environment) query.set("env", data.environment);
      router.push(`/checkout?${query.toString()}`);
    } catch {
      setError("Couldn't start checkout. Nothing was charged.");
    } finally {
      setSeatBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!editingId && !canAddVehicle) {
      setError(
        budget.plan === "pro"
          ? `Your plan covers ${budget.vehicleLimit} vehicles. Add one to make room.`
          : `Free covers ${budget.freeVehicles} vehicles — add a paid vehicle to go further.`
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
      remindersEnabled: true,
    };
    if (editingId) updateVehicle(editingId, payload);
    else addVehicle(payload);
    setForm(EMPTY);
    setEditingId(null);
    setError("");
  };

  const scanPhoto = async (e: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = ""; // allow re-picking the same file
    if (picked.length === 0) return;
    // More than five is not refused outright — the extras are simply not
    // sent, because rejecting a whole selection over a count the user cannot
    // see while choosing is a poor way to ask for fewer.
    const files = picked.slice(0, MAX_SCAN_IMAGES);
    setError("");
    setScanNote(null);
    setScanning(true);
    try {
      const images = await Promise.all(files.map((f) => fileToScaledDataUrl(f)));
      const res = await fetch("/api/vehicle-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.budget) applyBudget(data.budget);
      // The server refunds the scan when a photo turns out not to be a
      // vehicle, so the count on the button has to come back from it rather
      // than being decremented optimistically here.
      await refreshOrg();
      if (!res.ok) {
        const message =
          data.message ??
          "Couldn't read that photo. Please fill the form in yourself.";
        // A photo the app refused belongs in the scan banner at the top of
        // the form, next to the button that was just pressed — not in the
        // validation line below every field, where it reads as a form error
        // and is a whole form away from what caused it.
        if (data.error === "upgrade_required") {
          setScanUpsell(true);
        } else if (
          data.error === "not_vehicle" ||
          data.error === "unclear" ||
          data.error === "scan_quota"
        ) {
          setScanNote({ text: message, tone: "reject" });
        } else {
          setError(message);
        }
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
      setScanNote({
        text:
          (data.notes ? data.notes + " " : "") +
          (found.length
            ? `Filled in: ${found.join(", ")}. Please check each field, then Add vehicle.`
            : "I couldn't read any details — please fill the form in yourself."),
        // Nothing readable is a soft failure, not a refusal: it was a vehicle,
        // it just wasn't legible.
        tone: found.length ? "info" : "reject",
      });
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
          {budget.plan === "pro" ? (
            <>
              <p>
                You&apos;re paying for{" "}
                <b>
                  {budget.seats} vehicle{budget.seats === 1 ? "" : "s"}
                </b>
                . Adding another costs ${PLANS.pro.price}/month more, charged
                pro-rata for the rest of this billing period.
              </p>
              <button
                onClick={addSeat}
                disabled={seatBusy}
                className="btn-brand mt-3 rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                {seatBusy
                  ? "Updating…"
                  : `Add a vehicle to my plan (+$${PLANS.pro.price}/mo)`}
              </button>
            </>
          ) : (
            <>
              You&apos;ve filled all {budget.freeVehicles} free vehicles. Beyond
              that it&apos;s ${PLANS.pro.price} per vehicle per month, with no
              contract.{" "}
              <Link href="/pricing" className="font-semibold underline">
                See pricing
              </Link>
              .
            </>
          )}
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
              onClick={() =>
                canScan ? fileRef.current?.click() : setScanUpsell(true)
              }
              disabled={scanning || outOfScans}
              className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
              style={{ borderColor: "var(--brand)", color: "var(--brand)" }}
            >
              <svg width="15" height="15" viewBox="0 0 20 20" aria-hidden="true" fill="none">
                <path d="M3 7a2 2 0 012-2h1.2l.8-1.4A1 1 0 018 3h4a1 1 0 01.9.6L13.8 5H15a2 2 0 012 2v7a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" stroke="currentColor" strokeWidth="1.5"/>
                <circle cx="10" cy="10.5" r="2.6" stroke="currentColor" strokeWidth="1.5"/>
              </svg>
              {scanning
                ? "Reading photo…"
                : !canScan
                  ? "Scan a photo — upgrade"
                  : outOfScans
                    ? "No scans left today"
                    : `Scan a photo instead (${budget.scansRemaining} left)`}
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            onChange={scanPhoto}
            className="hidden"
          />
        </div>

        {scanUpsell && (
          <div
            role="alert"
            className="mb-3 rounded-lg border px-4 py-3 text-sm"
            style={{
              borderColor: "var(--brand)",
              background: "var(--brand-soft)",
            }}
          >
            <p className="font-semibold">
              Photo scanning is part of the paid plans
            </p>
            <p className="mt-1 text-[var(--text-secondary)]">
              Photograph a vehicle, its number plate, the VIN plate or the
              odometer — up to {MAX_SCAN_IMAGES} shots of the same vehicle at
              once — and MotorWise fills this form in for you. Photos that
              turn out not to be a vehicle don&apos;t use up a scan.
            </p>
            <ul className="mt-2 space-y-1 text-[var(--text-secondary)]">
              <li>
                <b>{PLANS.pro.name}</b> — {SCAN_LIMITS.pro} scans a day
              </li>
              <li>
                <b>{PLANS.business.name}</b> — {SCAN_LIMITS.business} scans a
                day
              </li>
              <li>
                <b>{PLANS.yearly.name}</b> — {SCAN_LIMITS.yearly} scans a day
              </li>
            </ul>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Link
                href="/pricing"
                className="btn-brand rounded-md px-4 py-2 text-sm font-medium"
              >
                See plans
              </Link>
              <button
                type="button"
                onClick={() => setScanUpsell(false)}
                className="text-sm text-[var(--text-secondary)] underline"
              >
                Not now — I&apos;ll type it in
              </button>
            </div>
          </div>
        )}

        {scanNote && (
          <div
            // assertive: a refused photo must be announced the moment it comes
            // back, not when the screen reader next happens to reach it.
            role={scanNote.tone === "reject" ? "alert" : "status"}
            aria-live={scanNote.tone === "reject" ? "assertive" : "polite"}
            className="mb-3 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm"
            style={
              scanNote.tone === "reject"
                ? {
                    borderColor: "var(--status-critical)",
                    background: "var(--status-critical-soft)",
                    color: "var(--status-critical)",
                  }
                : {
                    borderColor: "var(--brand)",
                    background: "var(--brand-soft)",
                  }
            }
          >
            {scanNote.tone === "reject" && (
              <svg
                width="16"
                height="16"
                viewBox="0 0 20 20"
                aria-hidden="true"
                fill="none"
                className="mt-0.5 shrink-0"
              >
                <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.5" />
                <path d="M10 6v4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <circle cx="10" cy="13.6" r="0.9" fill="currentColor" />
              </svg>
            )}
            <span>{scanNote.text}</span>
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

      {remindersOverCap && (
        <div
          role="alert"
          className="rounded-xl border px-4 py-3 text-sm"
          style={{
            borderColor: "var(--status-critical)",
            background: "var(--status-critical-soft)",
            color: "var(--status-critical)",
          }}
        >
          <b>
            Your plan covers reminders for {reminderCap} vehicle
            {reminderCap === 1 ? "" : "s"}, but {remindersOn} are switched on.
          </b>{" "}
          Until you choose, we email about the {reminderCap} oldest and skip
          the rest. Untick the ones you don&apos;t need, or{" "}
          <Link href="/pricing" className="underline">
            add them back to your plan
          </Link>
          .
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-[var(--surface-1)] dark:border-neutral-800">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-xs text-[var(--text-muted)] dark:border-neutral-800">
              <th className="px-4 py-2.5 font-medium">Registration</th>
              <th className="px-4 py-2.5 font-medium">Make / Model</th>
              <th className="px-4 py-2.5 font-medium">VIN</th>
              <th className="px-4 py-2.5 text-right font-medium">Mileage</th>
              <th className="px-4 py-2.5 text-right font-medium">Total cost</th>
              <th className="px-4 py-2.5 text-center font-medium">Reminders</th>
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
                <td className="px-4 py-2.5 text-center">
                  <input
                    type="checkbox"
                    checked={v.remindersEnabled}
                    aria-label={`Email reminders for ${v.registration}`}
                    // Turning one off is always allowed; turning one on is
                    // refused by Postgres once the plan's allowance is full,
                    // which is exactly the choice a downgraded customer has
                    // to make.
                    disabled={!v.remindersEnabled && remindersFull}
                    onChange={(e) =>
                      updateVehicle(v.id, { remindersEnabled: e.target.checked })
                    }
                    className="h-4 w-4 accent-neutral-900 dark:accent-white disabled:opacity-40"
                  />
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
