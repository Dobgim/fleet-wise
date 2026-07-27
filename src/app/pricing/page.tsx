"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useFleet } from "@/lib/store";
import {
  approxQuestions,
  BUSINESS_BREAK_EVEN,
  formatTokens,
  isCheaperOnBusiness,
  monthlyCost,
  PLANS,
  PLAN_ORDER,
  planLabel,
  TRIAL_DAYS,
  trialDaysLeft,
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

  // How many vehicles to buy on Premium. Defaults to the fleet they already
  // have, since that is what they will need on day one.
  const [qty, setQty] = useState(1);
  useEffect(() => {
    setQty(Math.max(1, budget.seats ?? vehicles.length));
  }, [budget.seats, vehicles.length]);

  const effective = budget.plan;
  const subscribed = effective === "pro" || effective === "business";
  const daysLeft = trialDaysLeft(budget.trialEndsAt);

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

  // The plan can change outside this tab — a webhook after checkout, or a
  // cancellation in Paddle. Re-read it whenever the page is opened.
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

  /** First purchase: Paddle-hosted checkout. */
  const startCheckout = async (id: PaidPlanId) => {
    setNotice("");
    setError("");
    const priceId = PADDLE_PRICE[id];
    if (!priceId || !orgId) {
      setError("Checkout isn't available right now. Please try again later.");
      return;
    }
    setBusy(id);
    try {
      await openPaddleCheckout({
        priceId,
        orgId,
        quantity: PLANS[id].perVehicle ? qty : 1,
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
   * a second checkout, which would bill them twice. The user sees the exact
   * prorated amount before anything is charged.
   */
  const changeSubscription = async (id: PaidPlanId) => {
    setNotice("");
    setError("");
    setBusy(id);
    try {
      const quantity = PLANS[id].perVehicle ? qty : 1;
      const pre = await fetch("/api/subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: id, quantity, preview: true }),
      });
      const preview = await pre.json();

      if (pre.status === 409) {
        // No subscription on record — fall back to a fresh checkout.
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

      const ok = window.confirm(
        `Switch to ${PLANS[id].name}${PLANS[id].perVehicle ? ` for ${quantity} vehicle${quantity === 1 ? "" : "s"}` : ""}?\n\n${line}`
      );
      if (!ok) return;

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
          {signedIn ? "Plans & billing" : "Pricing"}
        </h1>
        {signedIn ? (
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            You are on <span className="font-semibold">{planLabel(effective)}</span>
            {effective === "trial" && daysLeft > 0 && ` — ${daysLeft} day${daysLeft === 1 ? "" : "s"} left`}
            {" · "}
            {vehicles.length} vehicle{vehicles.length === 1 ? "" : "s"} ·{" "}
            {`${formatTokens(budget.remaining)} of ${formatTokens(budget.limit)} AI tokens left today`}
          </p>
        ) : (
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Track your vehicles, get warned before a service is due, and ask an
            AI about your own maintenance records. Every account starts with a{" "}
            {TRIAL_DAYS}-day free trial — no card needed.
          </p>
        )}
      </div>

      {effective === "none" && signedIn && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          <b>Your free trial has ended.</b> Your records are safe and still
          readable, but adding vehicles and asking the AI need a subscription.
        </div>
      )}

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

      {!BILLING_LIVE && (
        <p className="text-xs text-[var(--text-muted)]">
          Checkout is not configured yet — add the Paddle price IDs to enable
          it.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {PLAN_ORDER.map((id) => {
          const p = PLANS[id];
          const isCurrent = effective === id;
          const cost = monthlyCost(id, qty);
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
                  {p.perVehicle ? " per vehicle / month" : " /month"}
                </span>
              </p>

              {p.perVehicle && (
                <div className="mt-3 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
                  <label
                    htmlFor="qty"
                    className="block text-xs font-medium text-[var(--text-secondary)]"
                  >
                    How many vehicles?
                  </label>
                  <div className="mt-1.5 flex items-center gap-3">
                    <input
                      id="qty"
                      type="number"
                      min={1}
                      max={1000}
                      value={qty}
                      onChange={(e) =>
                        setQty(
                          Math.max(
                            1,
                            Math.min(1000, Number(e.target.value) || 1)
                          )
                        )
                      }
                      className="w-20 rounded-md border border-neutral-300 bg-transparent px-2 py-1.5 text-base sm:text-sm dark:border-neutral-700"
                    />
                    <span className="text-sm font-semibold">
                      = ${cost}/month
                    </span>
                  </div>
                  {isCheaperOnBusiness(qty) && (
                    <p className="mt-2 text-xs text-[var(--text-secondary)]">
                      With {qty} vehicles, <b>Business is cheaper</b> at $
                      {PLANS.business.price}/month — and unlimited.
                    </p>
                  )}
                </div>
              )}

              {!p.perVehicle && (
                <p className="mt-3 text-xs text-[var(--text-muted)]">
                  Better value from {BUSINESS_BREAK_EVEN} vehicles up.
                </p>
              )}

              <p className="mt-3 text-xs text-[var(--text-muted)]">
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

              {signedIn ? (
                <button
                  disabled={!BILLING_LIVE || busy !== null}
                  onClick={() => choose(id)}
                  className="btn-brand mt-5 rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
                >
                  {busy === id
                    ? "Working…"
                    : isCurrent && p.perVehicle
                      ? `Update to ${qty} vehicle${qty === 1 ? "" : "s"}`
                      : isCurrent
                        ? "Your plan"
                        : subscribed
                          ? `Switch to ${p.name}`
                          : `Subscribe — $${p.perVehicle ? cost : p.price}/mo`}
                </button>
              ) : (
                <Link
                  href="/signup"
                  className="btn-brand mt-5 rounded-md px-4 py-2 text-center text-sm font-medium"
                >
                  Start {TRIAL_DAYS}-day free trial
                </Link>
              )}
            </section>
          );
        })}
      </div>

      {subscribed && (
        <p className="text-sm text-[var(--text-secondary)]">
          To update your card or cancel, use the manage-subscription link in
          your Paddle receipt email. Paddle handles billing for Fleet Wise.
        </p>
      )}
    </main>
  );
}
