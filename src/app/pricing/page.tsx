"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useFleet } from "@/lib/store";
import { approxQuestions, formatTokens, PLANS, PLAN_ORDER } from "@/lib/plans";
import type { PlanId } from "@/lib/types";

const BILLING_LIVE = process.env.NEXT_PUBLIC_STRIPE_ENABLED === "true";

export default function PricingPage() {
  return (
    <Suspense
      fallback={<p className="p-8 text-sm text-[var(--text-muted)]">Loading…</p>}
    >
      <Pricing />
    </Suspense>
  );
}

function Pricing() {
  const { ready, plan, budget, vehicles, setPlan } = useFleet();
  const router = useRouter();
  const params = useSearchParams();
  const [busy, setBusy] = useState<PlanId | "portal" | null>(null);
  const [notice, setNotice] = useState("");

  // Banner after returning from Stripe Checkout.
  useEffect(() => {
    const c = params.get("checkout");
    if (c === "success")
      setNotice(
        "Payment received — thank you! Your new plan will be active within a few seconds."
      );
    else if (c === "cancelled")
      setNotice("Checkout cancelled — no charge was made.");
    if (c) router.replace("/pricing");
  }, [params, router]);

  if (!ready)
    return <p className="p-8 text-sm text-[var(--text-muted)]">Loading…</p>;

  const current = PLANS[plan];

  const choosePlan = async (id: PlanId) => {
    setNotice("");
    // Free = downgrade; paid = Stripe Checkout (or simulated before keys exist)
    if (!BILLING_LIVE) {
      setPlan(id);
      return;
    }
    if (id === "free") {
      // Cancelling a paid plan is done in the billing portal.
      return openPortal();
    }
    setBusy(id);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: id }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.url) {
        window.location.href = data.url;
        return;
      }
      setNotice(data.error ?? "Couldn't start checkout. Please try again.");
    } catch {
      setNotice("Couldn't reach the payment service. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const openPortal = async () => {
    setBusy("portal");
    setNotice("");
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.url) {
        window.location.href = data.url;
        return;
      }
      setNotice(data.error ?? "Couldn't open billing. Please try again.");
    } catch {
      setNotice("Couldn't reach the payment service. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Plans & billing</h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          You are on the <span className="font-semibold">{current.name}</span>{" "}
          plan · {vehicles.length}
          {current.maxVehicles !== null && ` / ${current.maxVehicles}`} vehicles
          ·{" "}
          {`${formatTokens(budget.remaining)} of ${formatTokens(budget.limit)} AI tokens left today`}
        </p>
        {!BILLING_LIVE && (
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Test mode: switching plans is simulated. Real card payments turn on
            once Stripe is connected.
          </p>
        )}
      </div>

      {notice && (
        <div
          className="rounded-lg border px-4 py-3 text-sm"
          style={{ borderColor: "var(--brand)", background: "var(--brand-soft)" }}
        >
          {notice}
        </div>
      )}

      {BILLING_LIVE && plan !== "free" && (
        <button
          onClick={openPortal}
          disabled={busy === "portal"}
          className="text-sm font-medium underline underline-offset-2 disabled:opacity-50"
          style={{ color: "var(--brand)" }}
        >
          {busy === "portal" ? "Opening…" : "Manage billing, update card, or cancel"}
        </button>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        {PLAN_ORDER.map((id) => {
          const p = PLANS[id];
          const isCurrent = id === plan;
          return (
            <section
              key={id}
              style={isCurrent ? { borderColor: "var(--brand)" } : undefined}
              className={`flex flex-col rounded-xl border bg-[var(--surface-1)] p-5 ${
                isCurrent ? "border-2" : "border-neutral-200 dark:border-neutral-800"
              }`}
            >
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold">{p.name}</h2>
                {isCurrent && (
                  <span className="btn-brand rounded-full px-2.5 py-0.5 text-xs font-medium">
                    Current plan
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">
                {p.blurb}
              </p>
              <p className="mt-4">
                <span className="text-3xl font-bold">${p.pricePerMonth}</span>
                <span className="text-sm text-[var(--text-muted)]">/month</span>
              </p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                ≈ {approxQuestions(p.dailyTokens)} AI questions a day
              </p>
              <ul className="mt-4 flex-1 space-y-2 text-sm">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <span style={{ color: "var(--status-good)" }}>✓</span>
                    {f}
                  </li>
                ))}
              </ul>
              <button
                disabled={isCurrent || busy === id}
                onClick={() => choosePlan(id)}
                className={`mt-5 rounded-md px-4 py-2 text-sm font-medium ${
                  isCurrent
                    ? "cursor-default border border-neutral-300 text-[var(--text-muted)] dark:border-neutral-700"
                    : "btn-brand"
                }`}
              >
                {isCurrent
                  ? "Your plan"
                  : busy === id
                    ? "Starting…"
                    : p.pricePerMonth === 0
                      ? BILLING_LIVE
                        ? "Cancel to Free"
                        : "Downgrade to Free"
                      : `Subscribe — $${p.pricePerMonth}/mo`}
              </button>
            </section>
          );
        })}
      </div>
    </main>
  );
}
