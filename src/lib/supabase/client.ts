import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-side Supabase client. Uses the anon key only — all data access
 * from here is subject to RLS.
 *
 * The placeholder fallbacks keep static prerendering from crashing when env
 * vars are absent (e.g. a build machine without them configured). They are
 * never used for real requests: effects don't run during prerender, and at
 * runtime the real values are inlined by Next.js.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://placeholder.supabase.co",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "placeholder-anon-key"
  );
}
