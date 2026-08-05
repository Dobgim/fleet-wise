import Link from "next/link";
import { COMPANY_LOCATION, SUPPORT_EMAIL } from "@/lib/company";

/**
 * Site footer. Beyond being useful, payment providers reviewing the site
 * look for reachable policy pages and a contact address — so these links
 * belong on every page, not buried.
 */
export function Footer() {
  return (
    <footer className="border-t border-neutral-200 px-4 py-6 text-xs text-[var(--text-muted)] dark:border-neutral-800">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-5 gap-y-2 text-center">
        <span>
          © {new Date().getFullYear()} MotorWise · {COMPANY_LOCATION}
        </span>
        <Link href="/pricing" className="hover:underline">
          Pricing
        </Link>
        <Link href="/terms" className="hover:underline">
          Terms
        </Link>
        <Link href="/privacy" className="hover:underline">
          Privacy
        </Link>
        <Link href="/refunds" className="hover:underline">
          Refunds
        </Link>
        <a href={`mailto:${SUPPORT_EMAIL}`} className="hover:underline">
          {SUPPORT_EMAIL}
        </a>
      </div>
    </footer>
  );
}
