"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useFleet } from "@/lib/store";
import {
  billableVehicles,
  BUSINESS_BREAK_EVEN,
  FREE_VEHICLES,
  isCheaperOnBusiness,
  monthlyCost,
  PLANS,
  PLAN_ORDER,
  planLabel,
  type PaidPlanId,
} from "@/lib/plans";
import { openPaddleCheckout, paddleEnabled } from "@/lib/paddle-client";

const PADDLE_PRICE: Record<string, string | undefined> = {
  pro: process.env.NEXT_PUBLIC_PADDLE_PRICE_PRO,
  business: process.env.NEXT_PUBLIC_PADDLE_PRICE_BUSINESS,
};

const BILLING_LIVE =
  paddleEnabled() && Boolean(PADDLE_PRICE.pro && PADDLE_PRICE.business);

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

  // Returning from checkout. Paddle sends the browser back within about a
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

  /** Vehicles to bill for at a given fleet size — the Paddle quantity. */
  const quantityFor = (id: PaidPlanId, size: number) =>
    PLANS[id].perVehicle ? Math.max(1, billableVehicles(size)) : 1;

  const startCheckout = async (id: PaidPlanId) => {
    setNotice("");
    setError("");
    // Say which of the two things is missing. "Not available right now"
    // sent us hunting through Paddle when the real cause was a workspace
    // that had failed to be created.
    const priceId = PADDLE_PRICE[id];
    if (!priceId) {
      setError(
        "Checkout isn't configured yet — the price for this plan is missing. (Set NEXT_PUBLIC_PADDLE_PRICE_PRO and NEXT_PUBLIC_PADDLE_PRICE_BUSINESS, then redeploy.)"
      );
      return;
    }
    if (!orgId) {
      setError(
        "Your workspace hasn't finished setting up, so there's nothing to attach a subscription to. Reload the page — if it keeps happening, contact us."
      );
      return;
    }
    setBusy(id);
    try {
      await openPaddleCheckout({
        priceId,
        orgId,
        quantity: quantityFor(id, fleet),
        email: userEmail ?? undefined,
        successUrl: `${window.location.origin}/pricing?checkout=success`,
      });
    } catch {
      setError("Couldn't open checkout. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  /**
   * Already subscribed: change the existing subscription rather than opening
   * a second checkout, which would bill them twice. The exact prorated amount
   * is shown and confirmed before anything is charged.
   */
  const changeSubscription = async (id: PaidPlanId) => {
    setNotice("");
    setError("");
    setBusy(id);
    try {
      const quantity = quantityFor(id, fleet);
      const pre = await fetch("/api/subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: id, quantity, preview: true }),
      });
      const preview = await pre.json();

      if (pre.status === 409) {
        await startCheckout(id);
        return;
      }
      if (!pre.ok) {
        setError(preview.error ?? "Couldn't price that change.");
        return;
      }

      const money = preview.charge as
        | { amount: number; currency: string; negative: boolean }
        | null;
      const line = money
        ? money.negative || money.amount === 0
          ? `You'll be credited ${money.currency} ${money.amount.toFixed(2)} toward your next bill.`
          : `You'll be charged ${money.currency} ${money.amount.toFixed(2)} now for the rest of this billing period.`
        : "Your subscription will be updated.";

      const what = PLANS[id].perVehicle
        ? `${PLANS[id].name} for ${fleet} vehicles (${quantity} charged)`
        : PLANS[id].name;
      if (!window.confirm(`Switch to ${what}?\n\n${line}`)) return;

      const res = await fetch("/api/subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: id, quantity }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Couldn't update your subscription.");
        return;
      }
      await refreshOrg();
      setNotice(`Updated — you're on ${PLANS[id].name}.`);
    } catch {
      setError("Couldn't update your subscription. Nothing was charged.");
    } finally {
      setBusy(null);
    }
  };

  const choose = (id: PaidPlanId) =>
    subscribed ? changeSubscription(id) : startCheckout(id);

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
            Free — {FREE_VEHICLES === 1 ? "1 vehicle" : `up to ${FREE_VEHICLES} vehicles`}
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
            {PLANS.business.price}/month flat, unlimited.
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
                  {p.perVehicle ? " per extra vehicle / month" : " /month flat"}
                </span>
              </p>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">
                {p.perVehicle
                  ? `${fleet} vehicles → $${cost}/month`
                  : `Unlimited vehicles → $${cost}/month`}
              </p>
              {!p.perVehicle && (
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  Better value from {BUSINESS_BREAK_EVEN} vehicles up.
                </p>
              )}

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
                  disabled={!BILLING_LIVE || busy !== null}
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
          " To update your card or cancel, use the manage-subscription link in your Paddle receipt email."}
      </p>
    </main>
  );
}
