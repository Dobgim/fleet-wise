/**
 * Translate Supabase auth errors into messages a non-technical user can act
 * on. Supabase sometimes returns empty or JSON-ish messages (e.g. "{}") —
 * those must never reach the screen.
 */
export function friendlyAuthError(
  rawMessage: string | undefined,
  context: "signup" | "login"
): string {
  const msg = (rawMessage ?? "").toLowerCase();
  const unreadable = !msg || msg === "{}" || msg.startsWith("{");

  if (msg.includes("already registered") || msg.includes("already exists"))
    return "An account with this email already exists. Try signing in instead.";
  if (msg.includes("invalid login credentials"))
    return "Wrong email or password. Check both and try again.";
  if (msg.includes("email not confirmed"))
    return "Your email isn't confirmed yet. Open the confirmation link we emailed you, then sign in.";
  if (msg.includes("password") && (msg.includes("weak") || msg.includes("should be")))
    return "That password is too weak. Use at least 8 characters with a mix of letters and numbers.";
  if (msg.includes("invalid") && msg.includes("email"))
    return "That email address doesn't look valid. Check it for typos.";
  if (msg.includes("rate limit") || msg.includes("too many"))
    return "Too many attempts right now. Wait a few minutes, then try again.";
  if (msg.includes("signups not allowed") || msg.includes("disabled"))
    return "Sign-ups are temporarily unavailable. Please try again later.";
  if (msg.includes("fetch") || msg.includes("network"))
    return "Couldn't reach the server. Check your internet connection and try again.";

  if (unreadable)
    return context === "signup"
      ? "We couldn't create your account right now — this is usually temporary. Wait a few minutes and try again. If it keeps failing, the daily email limit may be reached; try again in an hour."
      : "We couldn't sign you in right now — this is usually temporary. Wait a few minutes and try again.";

  // Unknown but readable message: show it, capitalized.
  return rawMessage!.charAt(0).toUpperCase() + rawMessage!.slice(1);
}
