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

interface PaddleGlobal {
  Environment: { set: (env: "sandbox" | "production") => void };
  Initialize: (opts: { token: string }) => void;
  Checkout: { open: (opts: PaddleCheckoutOptions) => void };
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
      p.Initialize({ token });
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
  email?: string;
  successUrl?: string;
}) {
  const paddle = await loadPaddle();
  paddle.Checkout.open({
    items: [{ priceId: params.priceId, quantity: 1 }],
    // Read back by the webhook to decide which garage just paid.
    customData: { org_id: params.orgId },
    ...(params.email && { customer: { email: params.email } }),
    settings: {
      ...(params.successUrl && { successUrl: params.successUrl }),
    },
  });
}
