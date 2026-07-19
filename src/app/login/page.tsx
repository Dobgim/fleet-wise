"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  };

  const input =
    "w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700";

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-4 rounded-xl border border-neutral-200 bg-[var(--surface-1)] p-6 dark:border-neutral-800"
      >
        <div>
          <h1 className="text-xl font-bold tracking-tight">Sign in</h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Welcome back to Fleet Copilot.
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
            placeholder="••••••••"
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
