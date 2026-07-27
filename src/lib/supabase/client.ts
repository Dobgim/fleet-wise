import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/** Returns the current Clerk session token, or null when signed out. */
export type TokenGetter = () => Promise<string | null>;

/**
 * Browser-side Supabase client, authenticated by Clerk.
 *
 * Pass a getter rather than a token: Clerk rotates session tokens every
 * minute, so anything captured once would be stale within the first minute of
 * use. Supabase calls the getter on every request and always gets a live one.
 *
 * The placeholder fallbacks keep static prerendering from crashing when env
 * vars are absent (e.g. a build machine without them configured). They are
 * never used for real requests: effects don't run during prerender, and at
 * runtime the real values are inlined by Next.js.
 */
export function createClient(getToken?: TokenGetter) {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://placeholder.supabase.co",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "placeholder-anon-key",
    getToken
      ? {
          async accessToken() {
            // supabase-js probes for a token while the client is being
            // constructed, which during prerendering happens on the server —
            // where Clerk's browser runtime does not exist and getToken()
            // throws. No token is needed there: prerendering renders the
            // signed-out shell.
            if (typeof window === "undefined") return null;
            return (await getToken()) ?? null;
          },
        }
      : undefined
  );
}
