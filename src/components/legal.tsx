import Link from "next/link";

/** Shared shell for the policy pages, so they read as one document set. */
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-6 sm:p-8">
      <Link
        href="/"
        className="text-xs text-[var(--text-muted)] hover:underline"
      >
        ← Fleet Wise
      </Link>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">{title}</h1>
      <p className="mt-1 text-sm text-[var(--text-muted)]">
        Last updated {updated}
      </p>
      <div className="legal mt-8 space-y-6 text-[15px] leading-relaxed">
        {children}
      </div>
    </main>
  );
}

export function Section({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">{heading}</h2>
      <div className="space-y-2 text-[var(--text-secondary)]">{children}</div>
    </section>
  );
}
