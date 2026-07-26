/**
 * Transactional email sending. Server-only.
 *
 * Two providers are supported so the product is not blocked on owning a
 * domain: Brevo works with any sender address on its free tier, Resend is
 * the better choice once a custom domain is verified. Whichever key is
 * present wins (Resend first).
 */

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
}

export type SendResult =
  | { ok: true; provider: "resend" | "brevo" }
  | { ok: false; error: string };

function fromName(): string {
  return process.env.EMAIL_FROM_NAME || "Fleet Wise";
}

function fromAddress(): string {
  return process.env.EMAIL_FROM || "no-reply@fleetwise.app";
}

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY || process.env.BREVO_API_KEY);
}

/** Which provider will actually be used — handy when diagnosing delivery. */
export function activeProvider(): "resend" | "brevo" | null {
  if (process.env.RESEND_API_KEY) return "resend";
  if (process.env.BREVO_API_KEY) return "brevo";
  return null;
}

export async function sendEmail(input: SendEmailInput): Promise<SendResult> {
  if (process.env.RESEND_API_KEY) return sendWithResend(input);
  if (process.env.BREVO_API_KEY) return sendWithBrevo(input);
  return { ok: false, error: "No email provider configured" };
}

async function sendWithResend(input: SendEmailInput): Promise<SendResult> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `${fromName()} <${fromAddress()}>`,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      ...(process.env.EMAIL_REPLY_TO && {
        reply_to: process.env.EMAIL_REPLY_TO,
      }),
    }),
  });
  if (!res.ok) {
    // Resend's body names the cause precisely (unverified domain, bad key,
    // sandbox restriction) — keep it, it is the difference between a
    // five-minute fix and an afternoon.
    return { ok: false, error: `Resend ${res.status}: ${await safeText(res)}` };
  }
  return { ok: true, provider: "resend" };
}

async function sendWithBrevo(input: SendEmailInput): Promise<SendResult> {
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": process.env.BREVO_API_KEY!,
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      sender: { name: fromName(), email: fromAddress() },
      to: [{ email: input.to }],
      subject: input.subject,
      htmlContent: input.html,
    }),
  });
  if (!res.ok) {
    return { ok: false, error: `Brevo ${res.status}: ${await safeText(res)}` };
  }
  return { ok: true, provider: "brevo" };
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return "(no body)";
  }
}
