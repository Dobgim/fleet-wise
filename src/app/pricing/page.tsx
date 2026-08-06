"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useFleet } from "@/lib/store";
import {
  billableVehicles,
  BUSINESS_BREAK_EVEN,
  BUSINESS_VEHICLES,
  exceedsPlan,
  FREE_VEHICLES,
  isCheaperOnBusiness,
  monthlyCost,
  PLANS,
  PLAN_ORDER,
  planLabel,
  type PaidPlanId,
} from "@/lib/plans";

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
  const { ready, budget, vehicles, orgId, userEmail, refreshOrg } = useFleet();
  const router = useRouter();
  const params = useSearchParams();
  const [busy, setBusy] = useState<PaidPlanId | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  // Fleet size the calculator is pricing. Starts at what they actually have,
  // or one past the free allowance for a visitor with nothing yet.
  const [fleet, setFleet] = useState(FREE_VEHICLES + 1);
  useEffect(() => {
    const owned = vehicles.length;
    const paidFor = FREE_VEHICLES + (budget.seats ?? 0);
    setFleet(Math.max(FREE_VEHICLES + 1, owned, paidFor));
  }, [vehicles.length, budget.seats]);

  const effective = budget.plan;
  const subscribed = effective === "pro" || effective === "business";

  // Returning from checkout. Whop sends the browser back within about a
  // second, but the plan is granted asynchronously by the webhook — so poll
  // for it rather than showing whatever the page happened to load with.
  useEffect(() => {
    const c = params.get("checkout");
    if (!c) return;
    router.replace("/pricing");

    if (c === "cancelled") {
      setNotice("Checkout cancelled — no charge was made.");
      return;
    }
    if (c !== "success") return;

    setNotice("Payment received — activating your plan…");
    let cancelled = false;
    let attempts = 0;
    const tick = async () => {
      if (cancelled) return;
      attempts++;
      await refreshOrg();
      if (attempts < 12 && !cancelled) setTimeout(tick, 2000);
      else if (!cancelled)
        setNotice(
          "Payment received. Your plan is taking longer than usual to activate — refresh in a moment, or contact us if it persists."
        );
    };
    void tick();
    return () => {
      cancelled = true;
    };
  }, [params, router, refreshOrg]);

  useEffect(() => {
    void refreshOrg();
  }, [refreshOrg]);

  useEffect(() => {
    if (subscribed && notice.startsWith("Payment received — activating")) {
      setNotice(`You're on ${planLabel(effective)} — thank you!`);
    }
  }, [subscribed, effective, notice]);

  if (!ready)
    return <p className="p-8 text-sm text-[var(--text-muted)]">Loading…</p>;

  const signedIn = Boolean(userEmail);

  /**
   * Start a checkout.
   *
   * Whop has no per-unit quantity, so a per-vehicle plan is sold as a single
   * plan priced at $5 x billable vehicles, created server-side. Changing
   * vehicle count later therefore means buying a replacement subscription —
   * the webhook cancels the one it supersedes, so nobody is billed twice.
   */
  const startCheckout = async (id: PaidPlanId) => {
    setNotice("");
    setError("");
    if (!orgId) {
      setError(
        "Your workspace hasn't finished setting up, so there's nothing to attach a subscription to. Reload the page — if it keeps happening, contact us."
      );
      return;
    }

    if (subscribed) {
      const what = PLANS[id].perVehicle
        ? `${PLANS[id].name} covering ${fleet} vehicles — $${monthlyCost(id, fleet)}/month`
        : `${PLANS[id].name} — $${PLANS[id].price}/month`;
      // Said plainly before any money moves: this replaces, it does not add.
      if (
        !window.confirm(
          `Switch to ${what}?\n\nYour current subscription is cancelled automatically once the new one starts, so you are never charged twice.`
        )
      )
        return;
    }

    setBusy(id);
    try {
      const res = await fetch("/api/whop/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: id, fleet }),
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
      setError("Couldn't start checkout. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const choose = (id: PaidPlanId) => startCheckout(id);

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {signedIn ? "Plans & billing" : "Simple per-vehicle pricing"}
        </h1>
        {signedIn ? (
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            You are on <span className="font-semibold">{planLabel(effective)}</span> ·{" "}
            {vehicles.length} vehicle{vehicles.length === 1 ? "" : "s"}
            {budget.vehicleLimit !== null && ` of ${budget.vehicleLimit} included`}
          </p>
        ) : (
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Your first vehicle is free, forever — no card, no contract. Beyond
            that it&apos;s ${PLANS.pro.price} per vehicle per month, and you can
            cancel in one click.
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
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
        >
          {error}
        </div>
      )}

      {/* ---- Free tier: stated plainly, not sold ---- */}
      <section
        className="rounded-xl border p-5"
        style={
          effective === "free"
            ? { borderColor: "var(--brand)", borderWidth: 2 }
            : { borderColor: "var(--brand)", background: "var(--brand-soft)" }
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold">
            {FREE_VEHICLES === 1
              ? "Free — 1 vehicle"
              : `Free — up to ${FREE_VEHICLES} vehicles`}
          </h2>
          {effective === "free" && (
            <span className="btn-brand rounded-full px-2.5 py-0.5 text-xs font-medium">
              Current plan
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Full dashboard, full service history, AI predictive maintenance and
          email reminders. No card, no time limit. You only pay when your fleet
          grows past {FREE_VEHICLES === 1 ? "one vehicle" : `${FREE_VEHICLES} vehicles`}.
        </p>
      </section>

      {/* ---- Calculator ---- */}
      <section className="rounded-xl border border-neutral-200 bg-[var(--surface-1)] p-5 dark:border-neutral-800">
        <label
          htmlFor="fleet"
          className="block text-sm font-semibold"
        >
          How many vehicles do you run?
        </label>
        <div className="mt-2 flex flex-wrap items-center gap-4">
          <input
            id="fleet"
            type="number"
            min={1}
            max={1000}
            value={fleet}
            onChange={(e) =>
              setFleet(Math.max(1, Math.min(1000, Number(e.target.value) || 1)))
            }
            className="w-24 rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-base dark:border-neutral-700"
          />
          <p className="text-sm text-[var(--text-secondary)]">
            {billableVehicles(fleet) === 0 ? (
              <>
                <b>Free.</b>{" "}
                {FREE_VEHICLES === 1
                  ? "Your first vehicle costs nothing."
                  : `Your first ${FREE_VEHICLES} vehicles cost nothing.`}
              </>
            ) : (
              <>
                {FREE_VEHICLES} free + {billableVehicles(fleet)} ×{" "}
                ${PLANS.pro.price}/mo ={" "}
                <b className="text-base">${monthlyCost("pro", fleet)}/month</b>
              </>
            )}
          </p>
        </div>
        {isCheaperOnBusiness(fleet) && (
          <p className="mt-3 text-sm text-[var(--text-secondary)]">
            At {fleet} vehicles, <b>Business works out cheaper</b> — $
            {PLANS.business.price}/month flat, up to {BUSINESS_VEHICLES}{" "}
            vehicles.
          </p>
        )}
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        {PLAN_ORDER.map((id) => {
          const p = PLANS[id];
          const isCurrent = effective === id;
          const cost = monthlyCost(id, fleet);
          return (
            <section
              key={id}
              style={isCurrent ? { borderColor: "var(--brand)" } : undefined}
              className={`flex flex-col rounded-xl border bg-[var(--surface-1)] p-5 ${
                isCurrent
                  ? "border-2"
                  : "border-neutral-200 dark:border-neutral-800"
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
                <span className="text-3xl font-bold">${p.price}</span>
                <span className="text-sm text-[var(--text-muted)]">
                  {p.perVehicle
                    ? " per extra vehicle / month"
                    : ` /${p.per} flat`}
                </span>
              </p>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">
                {p.perVehicle
                  ? `${fleet} vehicles → $${cost}/month`
                  : `Up to ${p.vehicles} vehicles → $${cost}/${p.per}`}
              </p>
              {!p.perVehicle &&
                (exceedsPlan(id, fleet) ? (
                  <p
                    className="mt-1 text-xs"
                    style={{ color: "var(--status-critical)" }}
                  >
                    {p.name} covers {p.vehicles} vehicles — {fleet} is too
                    many. Talk to us and we&apos;ll sort something out.
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    {id === "yearly"
                      ? `$${(p.price / 12).toFixed(2)} a month, paid yearly.`
                      : `Better value from ${BUSINESS_BREAK_EVEN} vehicles up.`}
                  </p>
                ))}

              <ul className="mt-4 flex-1 space-y-2 text-sm">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <span style={{ color: "var(--status-good)" }}>✓</span>
                    {f}
                  </li>
                ))}
              </ul>

              {signedIn ? (
                <button
                  disabled={
                    busy !== null || (!p.perVehicle && exceedsPlan(id, fleet))
                  }
                  onClick={() => choose(id)}
                  className="btn-brand mt-5 rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
                >
                  {busy === id
                    ? "Working…"
                    : isCurrent && p.perVehicle
                      ? `Update to ${fleet} vehicles`
                      : isCurrent
                        ? "Your plan"
                        : subscribed
                          ? `Switch to ${p.name}`
                          : `Choose ${p.name} — $${cost}/mo`}
                </button>
              ) : (
                <Link
                  href="/signup"
                  className="btn-brand mt-5 rounded-md px-4 py-2 text-center text-sm font-medium"
                >
                  Start free
                </Link>
              )}
            </section>
          );
        })}
      </div>

      <p className="text-sm text-[var(--text-secondary)]">
        All plans are monthly with <b>no contract</b> — cancel any time and you
        keep access until the end of the period you have paid for. AI use is
        subject to fair use; we will contact you long before it ever becomes an
        issue.
        {subscribed &&
          " To update your card or cancel, use the manage-subscription link in your Whop receipt email."}
      </p>
    </main>
  );
}
