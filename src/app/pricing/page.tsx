"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useFleet } from "@/lib/store";
import { approxQuestions, formatTokens, PLANS, PLAN_ORDER } from "@/lib/plans";
import { openPaddleCheckout, paddleEnabled } from "@/lib/paddle-client";
import type { PlanId } from "@/lib/types";

const PADDLE_PRICE: Record<string, string | undefined> = {
  pro: process.env.NEXT_PUBLIC_PADDLE_PRICE_PRO,
  business: process.env.NEXT_PUBLIC_PADDLE_PRICE_BUSINESS,
};

// Real checkout only once a client token and both price ids exist; until
// then the page keeps the simulated plan switch so limits stay testable.
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
  const { ready, plan, budget, vehicles, setPlan, orgId, userEmail, refreshOrg } =
    useFleet();
  const router = useRouter();
  const params = useSearchParams();
  const [busy, setBusy] = useState<PlanId | "portal" | null>(null);
  const [notice, setNotice] = useState("");

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
      // refreshOrg updates state; the effect below reacts to the new plan.
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

  // Stop polling and celebrate once the paid plan actually lands.
  useEffect(() => {
    if (plan !== "free" && notice.startsWith("Payment received — activating")) {
      setNotice(`You're on ${PLANS[plan].name} — thank you!`);
    }
  }, [plan, notice]);

  if (!ready)
    return <p className="p-8 text-sm text-[var(--text-muted)]">Loading…</p>;

  const signedIn = Boolean(userEmail);
  const current = PLANS[plan];

  const choosePlan = async (id: PlanId) => {
    setNotice("");
    // Before Paddle credentials exist the switch is simulated, so the plan
    // limits can still be exercised end to end.
    if (!BILLING_LIVE) {
      setPlan(id);
      return;
    }
    if (id === "free") {
      setNotice(
        "To cancel a paid plan, use the manage-subscription link in your Paddle receipt email."
      );
      return;
    }
    // Opening a second checkout would create a second subscription and bill
    // the customer twice. Plan changes belong in Paddle's own subscription
    // management, which prorates properly.
    if (plan !== "free") {
      setNotice(
        `You already have an active ${PLANS[plan].name} subscription. To move to ${PLANS[id].name}, use the manage-subscription link in your Paddle receipt email — buying here would charge you twice.`
      );
      return;
    }
    const priceId = PADDLE_PRICE[id];
    if (!priceId || !orgId) {
      setNotice("Checkout isn't available right now. Please try again later.");
      return;
    }

    setBusy(id);
    try {
      // Paddle hosts the payment form; the plan is granted by the webhook
      // once Paddle confirms payment, never by this click.
      await openPaddleCheckout({
        priceId,
        orgId,
        email: userEmail ?? undefined,
        successUrl: `${window.location.origin}/pricing?checkout=success`,
      });
    } catch {
      setNotice("Couldn't open checkout. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {signedIn ? "Plans & billing" : "Pricing"}
        </h1>
        {signedIn ? (
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            You are on the <span className="font-semibold">{current.name}</span>{" "}
            plan · {vehicles.length}
            {current.maxVehicles !== null && ` / ${current.maxVehicles}`} vehicles
            ·{" "}
            {`${formatTokens(budget.remaining)} of ${formatTokens(budget.limit)} AI tokens left today`}
          </p>
        ) : (
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Track your vehicles, get warned before a service is due, and ask an
            AI about your own maintenance records. Start free — no card needed.
          </p>
        )}
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
        <p className="text-sm text-[var(--text-secondary)]">
          To update your card or cancel, use the manage-subscription link in
          your Paddle receipt email. Paddle handles billing for Fleet Wise.
        </p>
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
              {signedIn ? (
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
                        ? "Switch to Free"
                        : `Subscribe — $${p.pricePerMonth}/mo`}
                </button>
              ) : (
                <Link
                  href="/signup"
                  className="btn-brand mt-5 rounded-md px-4 py-2 text-center text-sm font-medium"
                >
                  {p.pricePerMonth === 0 ? "Start free" : "Get started"}
                </Link>
              )}
            </section>
          );
        })}
      </div>
    </main>
  );
}
