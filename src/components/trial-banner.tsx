"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { trialDaysLeft } from "@/lib/plans";
import { useFleet } from "@/lib/store";

/**
 * A quiet strip above the app telling trial users where they stand.
 *
 * It appears only in the last week, so it does not nag on day one, and it
 * turns urgent on the final two days. On /pricing it stays hidden — the page
 * already says all of this, and repeating it there just adds noise.
 */
export function TrialBanner() {
  const { ready, userEmail, budget } = useFleet();
  const pathname = usePathname();

  if (!ready || !userEmail) return null;
  if (pathname.startsWith("/pricing")) return null;

  const days = trialDaysLeft(budget.trialEndsAt);

  if (budget.plan === "none") {
    return (
      <Strip urgent>
        Your free trial has ended. Your records are safe, but adding vehicles
        and using the AI need a plan.{" "}
        <Link href="/pricing" className="font-semibold underline">
          Choose a plan
        </Link>
      </Strip>
    );
  }

  if (budget.plan !== "trial" || days > 7) return null;

  return (
    <Strip urgent={days <= 2}>
      {days === 0
        ? "Your free trial ends today."
        : `${days} day${days === 1 ? "" : "s"} left on your free trial.`}{" "}
      <Link href="/pricing" className="font-semibold underline">
        See plans
      </Link>
    </Strip>
  );
}

function Strip({
  urgent,
  children,
}: {
  urgent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`px-4 py-2 text-center text-sm ${
        urgent
          ? "bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100"
          : "text-[var(--text-secondary)]"
      }`}
      style={urgent ? undefined : { background: "var(--brand-soft)" }}
    >
      {children}
    </div>
  );
}
