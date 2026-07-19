"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";

export default function SignupPage() {
  const router = useRouter();
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [checkEmail, setCheckEmail] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setBusy(true);
    setError("");
    const supabase = createClient();
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { company_name: company.trim() } },
    });
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    if (data.session) {
      // Email confirmation disabled — signed in straight away
      router.push("/dashboard");
      router.refresh();
    } else {
      // Confirmation required — org gets created on first sign-in
      setCheckEmail(true);
      setBusy(false);
    }
  };

  const input =
    "w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-base sm:text-sm outline-none focus:border-neutral-500 dark:border-neutral-700";

  if (checkEmail)
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-3 rounded-xl border border-neutral-200 bg-[var(--surface-1)] p-6 text-center dark:border-neutral-800">
          <h1 className="text-xl font-bold">Check your email 📬</h1>
          <p className="text-sm text-[var(--text-secondary)]">
            We sent a confirmation link to <strong>{email}</strong>. Click it,
            then{" "}
            <Link href="/login" className="underline">
              sign in
            </Link>{" "}
            — your workspace will be created automatically.
          </p>
        </div>
      </main>
    );

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-4 rounded-xl border border-neutral-200 bg-[var(--surface-1)] p-6 dark:border-neutral-800"
      >
        <div>
          <h1 className="text-xl font-bold tracking-tight">Create account</h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            For anyone with vehicles — one car, a family garage, or a whole
            company fleet.
          </p>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
            Name your garage (optional)
          </label>
          <input
            className={input}
            placeholder="e.g. Joshua's Cars or Kumba Express Logistics"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
          />
          <p className="mt-1 text-[11px] text-[var(--text-muted)]">
            Personal or business — anything works. Leave blank and we&apos;ll
            name it for you.
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
          <input
            className={input}
            type="password"
            required
            placeholder="At least 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && (
          <p className="text-sm" style={{ color: "var(--status-critical)" }}>
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          {busy ? "Creating…" : "Create account"}
        </button>
        <p className="text-center text-sm text-[var(--text-secondary)]">
          Already have an account?{" "}
          <Link href="/login" className="font-medium underline">
            Sign in
          </Link>
        </p>
      </form>
    </main>
  );
}
