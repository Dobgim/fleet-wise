import Link from "next/link";
import { Logo, Wordmark } from "@/components/logo";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <Logo size={64} />
      <h1 className="-mt-2 text-center text-3xl font-bold tracking-tight sm:text-4xl">
        <Wordmark />
      </h1>
      <p className="-mt-3 text-center text-sm font-medium uppercase tracking-widest text-[var(--text-muted)]">
        AI vehicle maintenance copilot
      </p>
      <p className="max-w-md text-center text-[var(--text-secondary)]">
        Fewer breakdowns, lower costs, less time buried in records. For car
        owners with more than one vehicle and businesses with whole fleets —
        track maintenance, get alerts, and ask the AI anything about your
        vehicles.
      </p>
      <div className="flex gap-4">
        <Link
          href="/signup"
          className="rounded-lg btn-brand px-5 py-2.5 text-sm font-medium"
        >
          Get started free
        </Link>
        <Link
          href="/login"
          className="rounded-lg border border-neutral-300 px-5 py-2.5 text-sm font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          Sign in
        </Link>
      </div>
    </main>
  );
}
