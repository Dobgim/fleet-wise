import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role client. BYPASSES RLS — use only in trusted server code
 * (Stripe webhooks, AI functions) and always scope queries by org_id
 * manually.
 */
export function createAdminClient() {
  if (typeof window !== "undefined") {
    throw new Error("createAdminClient must never run in the browser");
  }

  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
