"use client";

import Link from "next/link";
import Script from "next/script";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Hosts Whop's embedded checkout.
 *
 * Whop has no hosted checkout URL to redirect to — payment is an embed that
 * mounts into a div on our own page — so the flow is: /pricing creates a
 * session server-side, sends the browser here with its id, and Whop's loader
 * script renders the card form. Card details never touch this app.
 */
const LOADER = "https://js.whop.com/static/checkout/loader.js";

/**
 * Accept a URL only if it is HTTPS on whop.com or a subdomain of it.
 *
 * endsWith(".whop.com") alone would pass "evil-whop.com", and includes()
 * would pass "whop.com.evil.net" — hence the explicit equality-or-dot-suffix
 * test against the parsed hostname rather than a substring match on the
 * string.
 */
function safeWhopUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const isWhop = host === "whop.com" || host.endsWith(".whop.com");
    return url.protocol === "https:" && isWhop ? url.toString() : null;
  } catch {
    return null;
  }
}

export default function CheckoutPage() {
  return (
    <Suspense
      fallback={<p className="p-8 text-sm text-[var(--text-muted)]">Loading…</p>}
    >
      <Checkout />
    </Suspense>
  );
}

function Checkout() {
  const params = useSearchParams();
  const session = params.get("session");
  const plan = params.get("plan");
  // Carried from the API response, not read from a NEXT_PUBLIC_ variable:
  // the embed must target the same Whop that issued the session. It defaults
  // to production, so a sandbox plan without this renders Whop's own 404
  // page inside the payment box.
  const environment = params.get("env") === "production" ? "production" : "sandbox";
  // Whop's hosted page for this same session. Only accepted if it really is a
  // Whop URL — it arrives via the query string, so without this check a
  // crafted link could point the "having trouble" button at a phishing page
  // that looks like our checkout.
  const purchaseUrl = safeWhopUrl(params.get("url"));

  if (!session) {
    return (
      <main className="mx-auto w-full max-w-2xl flex-1 space-y-4 p-6">
        <h1 className="text-xl font-bold">Nothing to pay for</h1>
        <p className="text-sm text-[var(--text-secondary)]">
          This page needs a checkout started from the pricing page.
        </p>
        <Link href="/pricing" className="btn-brand rounded-md px-4 py-2 text-sm">
          Back to pricing
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 space-y-4 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Checkout</h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Payment is handled by Whop. Your card details never reach MotorWise.
        </p>
      </div>

      <div
        className="rounded-xl border border-neutral-200 bg-[var(--surface-1)] p-4 dark:border-neutral-800"
        data-whop-checkout-session={session}
        {...(plan && { "data-whop-checkout-plan-id": plan })}
        data-whop-checkout-environment={environment}
        data-whop-checkout-theme="system"
        // Whop redirects here itself once payment succeeds. The plan is
        // granted asynchronously by the webhook, and /pricing polls for it.
        data-whop-checkout-return-url="/pricing?checkout=success"
      >
        <p className="text-sm text-[var(--text-muted)]">Loading payment form…</p>
      </div>

      {purchaseUrl && (
        <p className="text-sm text-[var(--text-secondary)]">
          Payment form not appearing?{" "}
          <a
            href={purchaseUrl}
            className="font-medium underline"
            // noopener/noreferrer because this opens a payment page: the new
            // tab must not be able to reach back through window.opener.
            target="_blank"
            rel="noopener noreferrer"
          >
            Open checkout on Whop instead
          </a>
          .
        </p>
      )}

      {environment === "sandbox" && (
        <p
          className="rounded-lg border px-3 py-2 text-xs"
          style={{
            borderColor: "var(--brand)",
            background: "var(--brand-soft)",
          }}
        >
          <b>Sandbox mode</b> — no real money moves. Test card{" "}
          <code>4242 4242 4242 4242</code>, any future expiry, any CVC.
        </p>
      )}

      <Link
        href="/pricing"
        className="inline-block text-sm text-[var(--text-secondary)] underline"
      >
        Cancel and go back
      </Link>

      {/* afterInteractive, not beforeInteractive: the div above must exist in
          the DOM before Whop's loader looks for it. */}
      <Script src={LOADER} strategy="afterInteractive" />
    </main>
  );
}
