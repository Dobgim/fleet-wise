"use client";

import { useFleet } from "@/lib/store";
import { approxQuestions, formatTokens, PLANS, PLAN_ORDER } from "@/lib/plans";

export default function PricingPage() {
  const { ready, plan, budget, vehicles, setPlan } = useFleet();

  if (!ready)
    return <p className="p-8 text-sm text-[var(--text-muted)]">Loading…</p>;

  const current = PLANS[plan];

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
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          Local mode: switching plans is simulated so you can test the limits.
          Real card payments (Stripe) are wired in when the backend is
          connected.
        </p>
      </div>

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
                disabled={isCurrent}
                onClick={() => setPlan(id)}
                className={`mt-5 rounded-md px-4 py-2 text-sm font-medium ${
                  isCurrent
                    ? "cursor-default border border-neutral-300 text-[var(--text-muted)] dark:border-neutral-700"
                    : "btn-brand"
                }`}
              >
                {isCurrent
                  ? "Your plan"
                  : p.pricePerMonth === 0
                    ? "Downgrade to Free"
                    : `Subscribe — $${p.pricePerMonth}/mo`}
              </button>
            </section>
          );
        })}
      </div>
    </main>
  );
}
