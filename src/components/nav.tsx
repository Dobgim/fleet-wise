"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PLANS } from "@/lib/plans";
import { useFleet } from "@/lib/store";
import { Logo } from "./logo";

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
  const [open, setOpen] = useState(false);

  // Close the mobile menu whenever the route changes
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const handleSignOut = async () => {
    await signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <header className="sticky top-0 z-10 border-b border-neutral-200 bg-[var(--surface-1)] dark:border-neutral-800">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
        {/* Hamburger — mobile only, top-left */}
        {userEmail && (
          <button
            onClick={() => setOpen(!open)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            className="flex h-9 w-9 items-center justify-center rounded-md border border-neutral-300 sm:hidden dark:border-neutral-700"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              {open ? (
                <path
                  d="M4 4 L14 14 M14 4 L4 14"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              ) : (
                <path
                  d="M2 4.5 H16 M2 9 H16 M2 13.5 H16"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              )}
            </svg>
          </button>
        )}

        <Link
          href="/"
          className="flex items-center gap-2 text-sm font-bold tracking-tight"
        >
          <Logo size={24} />
          Fleet Wise
        </Link>

        {/* Desktop links */}
        {userEmail && (
          <nav className="hidden gap-1 text-sm sm:flex">
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
            <span className="hidden items-center gap-2 sm:flex">
              <Link
                href="/pricing"
                className="rounded-full border border-neutral-300 px-2.5 py-0.5 text-xs text-[var(--text-secondary)] hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
              >
                {PLANS[plan].name} plan
              </Link>
              <span
                className="max-w-45 truncate text-xs text-[var(--text-muted)]"
                title={userEmail}
              >
                {orgName ?? userEmail}
              </span>
              <button
                onClick={handleSignOut}
                className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs text-[var(--text-secondary)] hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
              >
                Sign out
              </button>
            </span>
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

      {/* Mobile dropdown menu */}
      {userEmail && open && (
        <nav className="border-t border-neutral-200 px-4 pb-4 pt-2 sm:hidden dark:border-neutral-800">
          <div className="flex flex-col gap-1">
            {LINKS.map((l) => {
              const active = pathname.startsWith(l.href);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`rounded-md px-3 py-2.5 text-sm ${
                    active
                      ? "bg-neutral-900 font-medium text-white dark:bg-white dark:text-neutral-900"
                      : "text-[var(--text-secondary)] hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  }`}
                >
                  {l.label}
                </Link>
              );
            })}
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-neutral-100 pt-3 dark:border-neutral-800">
            <div className="min-w-0">
              <p className="truncate text-xs font-medium">{orgName ?? userEmail}</p>
              <Link
                href="/pricing"
                className="text-xs text-[var(--text-muted)] underline-offset-2 hover:underline"
              >
                {PLANS[plan].name} plan · manage
              </Link>
            </div>
            <button
              onClick={handleSignOut}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs text-[var(--text-secondary)] dark:border-neutral-700"
            >
              Sign out
            </button>
          </div>
        </nav>
      )}
    </header>
  );
}
