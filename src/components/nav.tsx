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

  // Close the drawer on navigation; lock page scroll while it's open
  useEffect(() => {
    setOpen(false);
  }, [pathname]);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const handleSignOut = async () => {
    await signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <header className="sticky top-0 z-40 border-b border-neutral-200 bg-[var(--surface-1)] dark:border-neutral-800">
      {/* ---- Mobile header: hamburger | centered brand | action pill ---- */}
      <div className="relative flex items-center justify-between px-4 py-3 sm:hidden">
        <button
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-neutral-200 dark:border-neutral-700"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path
              d="M2 5.5 H16 M2 12.5 H10"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>

        <Link
          href="/"
          className="absolute left-1/2 -translate-x-1/2 text-base font-bold tracking-tight"
        >
          Fleet Wise
        </Link>

        {userEmail ? (
          <Link
            href="/pricing"
            className="rounded-full border border-neutral-200 px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] dark:border-neutral-700"
          >
            {PLANS[plan].name}
          </Link>
        ) : (
          <Link
            href="/login"
            className="rounded-full bg-neutral-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-neutral-900"
          >
            Log in
          </Link>
        )}
      </div>

      {/* ---- Desktop header ---- */}
      <div className="mx-auto hidden max-w-6xl items-center gap-3 px-4 py-3 sm:flex">
        <Link
          href="/"
          className="flex items-center gap-2 text-sm font-bold tracking-tight"
        >
          <Logo size={24} />
          Fleet Wise
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

      {/* ---- Mobile drawer: full-height slide-over, ChatGPT style ---- */}
      {open && (
        <div className="fixed inset-0 z-50 sm:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute inset-y-0 left-0 flex w-[85%] max-w-xs flex-col bg-[var(--surface-1)] p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-lg font-bold tracking-tight">
                <Logo size={28} />
                Fleet Wise
              </span>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="flex h-9 w-9 items-center justify-center rounded-full border border-neutral-200 dark:border-neutral-700"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <path
                    d="M3 3 L13 13 M13 3 L3 13"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>

            <nav className="mt-8 flex flex-col gap-1">
              {(userEmail
                ? LINKS
                : [{ href: "/login", label: "Sign in" }]
              ).map((l) => {
                const active = pathname.startsWith(l.href);
                return (
                  <Link
                    key={l.href}
                    href={l.href}
                    className={`rounded-lg px-3 py-3 text-base ${
                      active
                        ? "bg-neutral-100 font-semibold dark:bg-neutral-800"
                        : "text-[var(--text-secondary)]"
                    }`}
                  >
                    {l.label}
                  </Link>
                );
              })}
            </nav>

            <div className="mt-auto border-t border-neutral-200 pt-4 dark:border-neutral-800">
              {userEmail ? (
                <>
                  <p className="truncate text-sm font-medium">
                    {orgName ?? userEmail}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                    {PLANS[plan].name} plan
                  </p>
                  <div className="mt-3 flex gap-2">
                    <Link
                      href="/pricing"
                      className="flex-1 rounded-lg border border-neutral-300 px-3 py-2.5 text-center text-sm font-medium dark:border-neutral-700"
                    >
                      Upgrade
                    </Link>
                    <button
                      onClick={handleSignOut}
                      className="flex-1 rounded-lg bg-neutral-900 px-3 py-2.5 text-sm font-medium text-white dark:bg-white dark:text-neutral-900"
                    >
                      Sign out
                    </button>
                  </div>
                </>
              ) : (
                <Link
                  href="/signup"
                  className="block rounded-lg bg-neutral-900 px-3 py-2.5 text-center text-sm font-medium text-white dark:bg-white dark:text-neutral-900"
                >
                  Get started free
                </Link>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
