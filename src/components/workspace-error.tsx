"use client";

import { useFleet } from "@/lib/store";

/**
 * Shown when the garage could not be created or read.
 *
 * This exists because the failure it reports once went unnoticed for days:
 * the bootstrap logged to the console and carried on, so a signed-in user saw
 * an app with no data and a vague "checkout isn't available" — with nothing
 * anywhere saying the workspace had never been created.
 */
export function WorkspaceError() {
  const { ready, orgError } = useFleet();
  if (!ready || !orgError) return null;

  return (
    <div
      role="alert"
      className="border-b border-red-300 bg-red-50 px-4 py-3 text-center text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
    >
      <b>Something went wrong setting up your account.</b> {orgError}
    </div>
  );
}
