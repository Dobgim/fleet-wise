"use client";

import { UserProfile } from "@clerk/nextjs";
import { clerkAppearance } from "@/lib/clerk-appearance";

/**
 * Account and security settings.
 *
 * This is Clerk's own UserProfile rather than a hand-built 2FA screen. It
 * covers the parts that are easy to get wrong and expensive to get wrong:
 * enrolling an authenticator app, backup codes, active sessions, password
 * changes, and — the one that used to mean a support ticket — letting a user
 * recover their own account after losing their phone.
 */
export default function SecurityPage() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Account & security</h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Open <b>Security</b> below to turn on two-factor authentication — a
          6-digit code from your phone on top of your password. Save the backup
          codes it gives you somewhere safe; they are how you get back in if you
          lose the phone.
        </p>
      </div>

      <UserProfile
        routing="hash"
        appearance={{
          ...clerkAppearance,
          elements: {
            ...clerkAppearance.elements,
            rootBox: "w-full",
            cardBox: "w-full max-w-none shadow-none",
          },
        }}
      />
    </main>
  );
}
