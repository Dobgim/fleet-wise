/**
 * Paddle.js loader and checkout opener (browser only).
 *
 * Paddle hosts the payment form itself, so card details never touch this
 * app. The org id travels as customData and comes back on the webhook,
 * which is how a payment is attributed to the right garage.
 */

interface PaddleCheckoutOptions {
  items: { priceId: string; quantity: number }[];
  customData?: Record<string, string>;
  customer?: { email?: string };
  settings?: { successUrl?: string; theme?: "light" | "dark" };
}

interface PaddleEvent {
  name?: string;
  data?: unknown;
  error?: { detail?: string; code?: string };
}

interface PaddleGlobal {
  Environment: { set: (env: "sandbox" | "production") => void };
  Initialize: (opts: {
    token: string;
    eventCallback?: (event: PaddleEvent) => void;
  }) => void;
  Checkout: { open: (opts: PaddleCheckoutOptions) => void };
}

/**
 * Where checkout errors go.
 *
 * Paddle reports a rejected checkout through its event callback, not by
 * throwing — so without this a failure showed up only as an anonymous 400 in
 * the browser console while the page sat there looking fine. Set per call by
 * openPaddleCheckout.
 */
let onCheckoutError: ((message: string) => void) | null = null;

function describePaddleError(event: PaddleEvent): string {
  const detail = event.error?.detail ?? "";
  const text = detail.toLowerCase();

  // The common misconfigurations, named plainly rather than echoed as jargon.
  if (text.includes("domain") || text.includes("approved"))
    return "Paddle rejected this website. Add this domain under Paddle → Checkout settings → Approved domains (include localhost for local testing).";
  if (text.includes("payment link") || text.includes("default"))
    return "Paddle has no default payment link set. Add one under Paddle → Checkout settings.";
  if (text.includes("quantity"))
    return "That vehicle count is outside the range allowed on the Paddle price.";
  if (text.includes("price") && text.includes("not found"))
    return "That price no longer exists in Paddle — it may have been archived.";
  return detail
    ? `Paddle refused the checkout: ${detail}`
    : "Paddle refused the checkout. Check that this domain is approved and a default payment link is set.";
}

declare global {
  interface Window {
    Paddle?: PaddleGlobal;
  }
}

const SCRIPT_SRC = "https://cdn.paddle.com/paddle/v2/paddle.js";

let ready: Promise<PaddleGlobal> | null = null;

export function paddleEnabled(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN);
}

/** Load and initialise Paddle.js once, reusing the same promise after that. */
export function loadPaddle(): Promise<PaddleGlobal> {
  if (ready) return ready;

  ready = new Promise((resolve, reject) => {
    const token = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN;
    if (!token) return reject(new Error("Paddle client token not configured"));

    const init = () => {
      const p = window.Paddle;
      if (!p) return reject(new Error("Paddle.js did not load"));
      // Sandbox unless explicitly in production, so a misconfiguration
      // cannot take real money.
      if (process.env.NEXT_PUBLIC_PADDLE_ENV !== "production") {
        p.Environment.set("sandbox");
      }
      p.Initialize({
        token,
        eventCallback: (event) => {
          if (event?.name === "checkout.error") {
            console.error("paddle checkout error", event);
            onCheckoutError?.(describePaddleError(event));
          }
        },
      });
      resolve(p);
    };

    if (window.Paddle) return init();

    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${SCRIPT_SRC}"]`
    );
    if (existing) {
      existing.addEventListener("load", init);
      existing.addEventListener("error", () =>
        reject(new Error("Could not reach Paddle"))
      );
      return;
    }

    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = init;
    script.onerror = () => reject(new Error("Could not reach Paddle"));
    document.head.appendChild(script);
  });

  return ready;
}

export async function openPaddleCheckout(params: {
  priceId: string;
  orgId: string;
  /** Vehicles to bill for on a per-vehicle price. Flat plans stay at 1. */
  quantity?: number;
  email?: string;
  successUrl?: string;
  /** Called if Paddle rejects the checkout after the overlay opens. */
  onError?: (message: string) => void;
}) {
  onCheckoutError = params.onError ?? null;
  const paddle = await loadPaddle();
  paddle.Checkout.open({
    items: [
      { priceId: params.priceId, quantity: Math.max(1, params.quantity ?? 1) },
    ],
    // Read back by the webhook to decide which garage just paid.
    customData: { org_id: params.orgId },
    ...(params.email && { customer: { email: params.email } }),
    settings: {
      ...(params.successUrl && { successUrl: params.successUrl }),
    },
  });
}
