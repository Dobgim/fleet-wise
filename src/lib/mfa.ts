import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Two-factor authentication (TOTP) helpers.
 *
 * TOTP is the Google Authenticator / Authy / 1Password scheme: the server and
 * the phone share one secret, and both derive the same 6-digit code from it
 * plus the current 30-second window. Nothing travels over the network, so
 * there is no SMS to intercept and no code to phish for longer than a moment.
 *
 * Supabase calls these "assurance levels": aal1 = password only, aal2 =
 * password plus a fresh code. A user who has enrolled a factor gets a session
 * at aal1 after signing in, and must clear a challenge to reach aal2.
 */

/** What the API returns when a half-authenticated session tries to do work. */
export const MFA_REQUIRED =
  "Finish signing in with your 6-digit code before using the AI.";

/** Does this session still owe a 6-digit code? */
export async function needsMfaChallenge(
  supabase: SupabaseClient
): Promise<boolean> {
  const { data, error } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || !data) return false;
  return data.nextLevel === "aal2" && data.currentLevel !== "aal2";
}

/** The user's verified authenticator, or null if they have not enrolled one. */
export async function verifiedTotpFactor(supabase: SupabaseClient) {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error || !data) return null;
  return data.totp?.find((f) => f.status === "verified") ?? null;
}

/** Digits only, capped at six — what an authenticator app ever produces. */
export function normalizeCode(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 6);
}

/**
 * Turn a Supabase MFA error into something a person can act on. The raw
 * messages talk about factors and challenges; the user typed a number.
 */
export function friendlyMfaError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid totp code") || m.includes("invalid code"))
    return "That code isn't right. Check your authenticator app and enter the current 6 digits — they change every 30 seconds.";
  if (m.includes("expired"))
    return "That code expired. Enter the one showing in your app right now.";
  if (m.includes("rate limit") || m.includes("too many"))
    return "Too many attempts. Wait a minute, then try again.";
  if (m.includes("already exists") || m.includes("friendly name"))
    return "You already have an authenticator set up. Remove it first if you want to add a new one.";
  return message || "Something went wrong. Please try again.";
}
