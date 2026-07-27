"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { friendlyAuthError } from "@/lib/auth-errors";
import { CodeInput } from "@/components/code-input";
import { PasswordInput } from "@/components/password-input";
import { friendlyMfaError, needsMfaChallenge, verifiedTotpFactor } from "@/lib/mfa";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Set once the password is accepted but the account also has an
  // authenticator enrolled — the session exists at aal1 and is useless until
  // a code lifts it to aal2.
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");

  // A confirmation link that didn't work. The route handler sends the reason
  // here rather than dumping the user on a blank page.
  useEffect(() => {
    const reason = new URLSearchParams(window.location.search).get("verify");
    if (!reason) return;
    setError(
      reason === "expired"
        ? "That confirmation link has expired or was already used. Sign in below — we'll send a fresh one if your email still needs confirming."
        : "That confirmation link was not valid. Try clicking it again from the email, or sign up once more."
    );
    window.history.replaceState({}, "", "/login");
  }, []);

  // Landing here already half signed in — a refresh mid-challenge, or the
  // middleware bouncing a protected page back. Resume at the code step rather
  // than making them type their password a second time.
  useEffect(() => {
    const supabase = createClient();
    void (async () => {
      if (!(await needsMfaChallenge(supabase))) return;
      const factor = await verifiedTotpFactor(supabase);
      if (factor) setFactorId(factor.id);
    })();
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const supabase = createClient();
    let error;
    try {
      ({ error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      }));
    } catch (e) {
      setError(friendlyAuthError(e instanceof Error ? e.message : "", "login"));
      setBusy(false);
      return;
    }
    if (error) {
      setError(friendlyAuthError(error.message, "login"));
      setBusy(false);
      return;
    }

    if (await needsMfaChallenge(supabase)) {
      const factor = await verifiedTotpFactor(supabase);
      if (factor) {
        setFactorId(factor.id);
        setBusy(false);
        return;
      }
    }

    router.push("/dashboard");
    router.refresh();
  };

  /** Second step: exchange a 6-digit code for a full-strength session. */
  const verify = async (submitted?: string) => {
    const value = submitted ?? code;
    if (!factorId || value.length !== 6 || busy) return;
    setBusy(true);
    setError("");
    const supabase = createClient();
    const { error } = await supabase.auth.mfa.challengeAndVerify({
      factorId,
      code: value,
    });
    if (error) {
      setError(friendlyMfaError(error.message));
      setCode("");
      setBusy(false);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  };

  /**
   * Leaving the code screen must also drop the half-strength session —
   * otherwise it lingers in the browser, and while the database rejects it,
   * a stale session is not something to leave lying around.
   */
  const cancelMfa = async () => {
    await createClient().auth.signOut();
    setFactorId(null);
    setCode("");
    setPassword("");
    setError("");
  };

  const input =
    "w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-base sm:text-sm outline-none focus:border-neutral-500 dark:border-neutral-700";

  if (factorId)
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void verify();
          }}
          className="w-full max-w-sm space-y-4 rounded-xl border border-neutral-200 bg-[var(--surface-1)] p-6 dark:border-neutral-800"
        >
          <div>
            <h1 className="text-xl font-bold tracking-tight">
              Enter your 6-digit code
            </h1>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              Open your authenticator app (Google Authenticator, Authy, or your
              password manager) and type the code showing for Fleet Wise.
            </p>
          </div>
          <CodeInput
            value={code}
            onChange={setCode}
            onComplete={(c) => void verify(c)}
            autoFocus
            disabled={busy}
          />
          {error && (
            <div
              role="alert"
              className="rounded-lg border border-red-300 bg-red-50 px-3 py-2.5 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
            >
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={busy || code.length !== 6}
            className="w-full rounded-md btn-brand px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {busy ? "Verifying…" : "Verify"}
          </button>
          <button
            type="button"
            onClick={cancelMfa}
            className="w-full text-center text-sm text-[var(--text-secondary)] underline"
          >
            Use a different account
          </button>
          <p className="text-center text-xs text-[var(--text-muted)]">
            Lost your phone? Contact support — we verify your identity before
            removing two-factor authentication.
          </p>
        </form>
      </main>
    );

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-4 rounded-xl border border-neutral-200 bg-[var(--surface-1)] p-6 dark:border-neutral-800"
      >
        <div>
          <h1 className="text-xl font-bold tracking-tight">Sign in</h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Welcome back to Fleet Wise.
          </p>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
            Email
          </label>
          <input
            className={input}
            type="email"
            required
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
            Password
          </label>
          <PasswordInput
            value={password}
            onChange={setPassword}
            placeholder="••••••••"
            autoComplete="current-password"
          />
        </div>
        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-300 bg-red-50 px-3 py-2.5 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
          >
            {error}
          </div>
        )}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md btn-brand px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <p className="text-center text-sm text-[var(--text-secondary)]">
          New here?{" "}
          <Link href="/signup" className="font-medium underline">
            Create an account
          </Link>
        </p>
      </form>
    </main>
  );
}
