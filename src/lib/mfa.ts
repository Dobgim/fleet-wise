/**
 * Two-factor authentication.
 *
 * Clerk owns the whole user-facing side of this now: enrolling an
 * authenticator app, prompting for the code at sign-in, backup codes, and
 * self-service recovery. None of that lives in this codebase any more.
 *
 * What remains ours is the guarantee that 2FA cannot be walked around. That
 * is enforced in Postgres (migration 0011): if `profiles.mfa_enabled` is true
 * for a user, every policy demands that the Clerk token's `fva` claim shows a
 * second factor was actually verified. So the check is not "did the app ask?"
 * but "does the token prove it?" — which a stolen token pointed straight at
 * the REST API cannot fake.
 *
 * This message is what the API returns when that check refuses.
 */
export const MFA_REQUIRED =
  "Finish signing in with your 6-digit code before using the AI.";
