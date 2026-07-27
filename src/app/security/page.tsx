"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { CodeInput } from "@/components/code-input";
import { friendlyMfaError } from "@/lib/mfa";
import { createClient } from "@/lib/supabase/client";

type Stage = "loading" | "off" | "enrolling" | "on";

export default function SecurityPage() {
  const [stage, setStage] = useState<Stage>("loading");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qr, setQr] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [showSecret, setShowSecret] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) {
      setError(friendlyMfaError(error.message));
      setStage("off");
      return;
    }
    const verified = data.totp?.find((f) => f.status === "verified");
    if (verified) {
      setFactorId(verified.id);
      setStage("on");
      return;
    }
    // An abandoned enrolment leaves an unverified factor behind, which then
    // collides with the next attempt. Clear them out before offering to start.
    for (const f of data.all ?? []) {
      if (f.status !== "verified")
        await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
    setFactorId(null);
    setStage("off");
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const startEnrolment = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    const supabase = createClient();
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: `Authenticator ${Date.now()}`,
      issuer: "Fleet Wise",
    });
    setBusy(false);
    if (error || !data) {
      setError(friendlyMfaError(error?.message ?? ""));
      return;
    }
    setFactorId(data.id);
    setQr(data.totp.qr_code);
    setSecret(data.totp.secret);
    setCode("");
    setStage("enrolling");
  };

  /** The code proves the phone really holds the secret — only then is it saved. */
  const confirmEnrolment = async (submitted?: string) => {
    const value = submitted ?? code;
    if (!factorId || value.length !== 6 || busy) return;
    setBusy(true);
    setError("");
    const supabase = createClient();
    const { error } = await supabase.auth.mfa.challengeAndVerify({
      factorId,
      code: value,
    });
    setBusy(false);
    if (error) {
      setError(friendlyMfaError(error.message));
      setCode("");
      return;
    }
    setNotice(
      "Two-factor authentication is on. From now on you'll need a code from your phone to sign in."
    );
    setStage("on");
  };

  const cancelEnrolment = async () => {
    if (factorId) await createClient().auth.mfa.unenroll({ factorId });
    setCode("");
    setError("");
    await load();
  };

  const turnOff = async () => {
    if (!factorId) return;
    const ok = window.confirm(
      "Turn off two-factor authentication? Your account will be protected by your password alone."
    );
    if (!ok) return;
    setBusy(true);
    const { error } = await createClient().auth.mfa.unenroll({ factorId });
    setBusy(false);
    if (error) {
      setError(friendlyMfaError(error.message));
      return;
    }
    setNotice("Two-factor authentication is off.");
    await load();
  };

  const card =
    "rounded-xl border border-neutral-200 bg-[var(--surface-1)] p-5 dark:border-neutral-800";

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Security</h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Extra protection for your account and your fleet&apos;s records.
        </p>
      </div>

      {notice && (
        <div
          className="rounded-lg border px-4 py-3 text-sm"
          style={{ borderColor: "var(--brand)", background: "var(--brand-soft)" }}
        >
          {notice}
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
        >
          {error}
        </div>
      )}

      <section className={card}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Two-factor authentication</h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              A 6-digit code from your phone, on top of your password. Even if
              someone learns your password, they cannot get in without your
              phone.
            </p>
          </div>
          {stage === "on" && (
            <span
              className="rounded-full px-2.5 py-0.5 text-xs font-medium"
              style={{
                background: "var(--brand-soft)",
                color: "var(--brand)",
              }}
            >
              On
            </span>
          )}
        </div>

        {stage === "loading" && (
          <p className="mt-4 text-sm text-[var(--text-muted)]">Loading…</p>
        )}

        {stage === "off" && (
          <div className="mt-4">
            <p className="text-sm text-[var(--text-secondary)]">
              You&apos;ll need a free authenticator app:{" "}
              <b>Google Authenticator</b>, Microsoft Authenticator, Authy, or
              the one built into your password manager.
            </p>
            <button
              onClick={startEnrolment}
              disabled={busy}
              className="btn-brand mt-4 rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {busy ? "Starting…" : "Turn on two-factor authentication"}
            </button>
          </div>
        )}

        {stage === "enrolling" && (
          <div className="mt-5 space-y-5">
            <Step n={1} title="Scan this with your authenticator app">
              {qr && (
                <div className="mt-3 inline-block rounded-lg bg-white p-3">
                  {/* Supabase returns the QR as an inline SVG data URI, so
                      there is no network request and nothing to leak. */}
                  <Image
                    src={qr}
                    alt="QR code for setting up two-factor authentication"
                    width={180}
                    height={180}
                    unoptimized
                  />
                </div>
              )}
              <p className="mt-2 text-xs text-[var(--text-muted)]">
                In the app, tap <b>+</b> then <b>Scan a QR code</b>.
              </p>
              <button
                type="button"
                onClick={() => setShowSecret((s) => !s)}
                className="mt-2 text-xs underline text-[var(--text-secondary)]"
              >
                {showSecret ? "Hide" : "Can't scan? Enter a code by hand"}
              </button>
              {showSecret && (
                <p className="mt-2 rounded-md border border-neutral-200 px-3 py-2 font-mono text-xs break-all dark:border-neutral-700">
                  {secret}
                </p>
              )}
            </Step>

            <Step n={2} title="Type the 6 digits it shows">
              <div className="mt-3 max-w-50">
                <CodeInput
                  value={code}
                  onChange={setCode}
                  onComplete={(c) => void confirmEnrolment(c)}
                  autoFocus
                  disabled={busy}
                />
              </div>
              <p className="mt-2 text-xs text-[var(--text-muted)]">
                The code changes every 30 seconds — that is normal.
              </p>
            </Step>

            <div className="flex gap-2">
              <button
                onClick={() => void confirmEnrolment()}
                disabled={busy || code.length !== 6}
                className="btn-brand rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                {busy ? "Checking…" : "Confirm and turn on"}
              </button>
              <button
                onClick={cancelEnrolment}
                disabled={busy}
                className="rounded-md border border-neutral-300 px-4 py-2 text-sm dark:border-neutral-700"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {stage === "on" && (
          <div className="mt-4">
            <p className="text-sm text-[var(--text-secondary)]">
              You&apos;ll be asked for a code from your authenticator app each
              time you sign in.
            </p>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              <b>Keep a backup.</b> If you lose the phone with the app on it,
              you lose access. Most authenticator apps can back up to your
              Google or Apple account — turn that on now.
            </p>
            <button
              onClick={turnOff}
              disabled={busy}
              className="mt-4 rounded-md border border-red-300 px-4 py-2 text-sm text-red-700 disabled:opacity-50 dark:border-red-800 dark:text-red-300"
            >
              Turn off
            </button>
          </div>
        )}
      </section>

      <section className={card}>
        <h2 className="text-lg font-bold">Email address</h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          New accounts must confirm their email before signing in. That link is
          also how we send maintenance reminders and receipts, so it has to be
          an address you actually read.
        </p>
      </section>
    </main>
  );
}

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <span
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold"
        style={{ background: "var(--brand)", color: "var(--brand-ink)" }}
      >
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{title}</p>
        {children}
      </div>
    </div>
  );
}
