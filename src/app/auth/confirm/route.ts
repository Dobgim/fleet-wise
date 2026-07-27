import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Where the confirmation link in the sign-up email lands.
 *
 * The link carries a one-time token_hash, which this route exchanges for a
 * real session and then drops from the URL. Doing the exchange server-side
 * means the token never reaches client JavaScript and never sits in the
 * browser history or a referrer header.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/dashboard";

  const fail = (reason: string) =>
    NextResponse.redirect(`${origin}/login?verify=${reason}`);

  if (!token_hash || !type) return fail("invalid");

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash });
  if (error) {
    // Overwhelmingly this is an expired link or one already used — the user
    // clicked it twice, or waited a day.
    console.error("email confirmation failed", error.message);
    return fail("expired");
  }

  // Only ever redirect within this site: `next` comes from the URL, so an
  // attacker could otherwise turn our confirmation link into an open redirect.
  const dest = next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
  return NextResponse.redirect(`${origin}${dest}`);
}
