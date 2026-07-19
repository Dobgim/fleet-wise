"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { PLANS } from "@/lib/plans";
import { useFleet } from "@/lib/store";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/vehicles", label: "Vehicles" },
  { href: "/copilot", label: "AI Copilot" },
  { href: "/pricing", label: "Pricing" },
];

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const { plan, userEmail, orgName, signOut } = useFleet();

  return (
    <header className="sticky top-0 z-10 border-b border-neutral-200 bg-[var(--surface-1)] dark:border-neutral-800">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" className="text-sm font-bold tracking-tight">
          🚚 Fleet Copilot
        </Link>
        {userEmail && (
          <nav className="flex gap-1 text-sm">
            {LINKS.map((l) => {
              const active = pathname.startsWith(l.href);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`rounded-md px-3 py-1.5 ${
                    active
                      ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                      : "text-[var(--text-secondary)] hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  }`}
                >
                  {l.label}
                </Link>
              );
            })}
          </nav>
        )}
        <span className="ml-auto flex items-center gap-2">
          {userEmail ? (
            <>
              <Link
                href="/pricing"
                className="rounded-full border border-neutral-300 px-2.5 py-0.5 text-xs text-[var(--text-secondary)] hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
              >
                {PLANS[plan].name} plan
              </Link>
              <span
                className="hidden max-w-45 truncate text-xs text-[var(--text-muted)] sm:inline"
                title={userEmail}
              >
                {orgName ?? userEmail}
              </span>
              <button
                onClick={async () => {
                  await signOut();
                  router.push("/login");
                  router.refresh();
                }}
                className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs text-[var(--text-secondary)] hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="rounded-md px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                Sign in
              </Link>
              <Link
                href="/signup"
                className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
              >
                Get started
              </Link>
            </>
          )}
        </span>
      </div>
    </header>
  );
}
