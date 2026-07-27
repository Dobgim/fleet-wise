import { auth } from "@clerk/nextjs/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client for Route Handlers and Server Components.
 *
 * Identity comes from Clerk. The `accessToken` hook hands Supabase the Clerk
 * session token on each request, and Supabase — configured with Clerk as a
 * third-party auth provider — verifies it against Clerk's public keys. RLS
 * then reads the caller's ID from the token's `sub` claim.
 *
 * There is no Supabase session and no auth cookie any more; the token is
 * fetched fresh per request, so a signed-out user simply gets no token and
 * every policy denies.
 */
export async function createClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://placeholder.supabase.co",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "placeholder-anon-key",
    {
      async accessToken() {
        return (await auth()).getToken();
      },
    }
  );
}
