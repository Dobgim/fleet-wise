/**
 * Which AI provider MotorWise talks to. Server-only.
 *
 * The API is OpenAI's chat-completions shape, but OpenAI is not the only
 * thing that speaks it: OpenRouter, Groq, Together and a local Ollama all
 * accept the same request and return the same response. Keeping the base URL
 * in configuration rather than in two hardcoded fetch calls means switching
 * provider is an environment variable, not a code change.
 *
 * That matters more here than it would elsewhere. Card payments to US
 * services are unreliable from Cameroon, and the product's headline feature
 * should not be hostage to whether one bank approves a $5 charge.
 */

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

/** Base URL without a trailing slash, so callers can append "/chat/completions". */
export function aiBaseUrl(): string {
  const raw = process.env.OPENAI_BASE_URL?.trim() || DEFAULT_BASE_URL;
  return raw.replace(/\/+$/, "");
}

export function aiChatUrl(): string {
  return `${aiBaseUrl()}/chat/completions`;
}

/**
 * Headers for a chat request.
 *
 * OpenRouter asks callers to identify themselves; it is optional but it is
 * what puts a name rather than a bare key in your usage dashboard, and other
 * providers ignore the extra headers.
 */
export function aiHeaders(apiKey: string): Record<string, string> {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://motorwise.co";
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": siteUrl,
    "X-Title": "MotorWise",
  };
}

/**
 * Turn a provider failure into something a mechanic can act on.
 *
 * The three that actually happen are an unfunded account, a dead key and a
 * model name the provider does not recognise — and each has a different fix,
 * so "AI unavailable" wastes the one clue there was. The detail is logged;
 * only the plain sentence reaches the browser.
 */
export function describeAiFailure(status: number, detail: string): string {
  const text = detail.toLowerCase();

  if (status === 401 || text.includes("invalid_api_key")) {
    return "The AI key is invalid or has been revoked. Please fill the form in manually for now.";
  }
  if (
    status === 402 ||
    text.includes("credit_balance") ||
    text.includes("insufficient")
  ) {
    return "The AI account is out of credit. Please fill the form in manually for now.";
  }
  if (text.includes("model") && (text.includes("not found") || text.includes("does not exist"))) {
    return "The configured AI model isn't available on this provider. Please fill the form in manually for now.";
  }
  if (status === 429) {
    return "The AI is rate-limited right now. Try again in a moment.";
  }
  return "";
}
