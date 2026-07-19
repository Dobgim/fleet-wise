import Link from "next/link";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-center text-4xl font-bold tracking-tight">
        Fleet Wise
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
          className="rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
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
