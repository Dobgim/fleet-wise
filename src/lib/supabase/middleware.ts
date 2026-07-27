import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the auth session on every request so Server Components always
 * see a valid token. Route protection (redirect to /login) is layered on
 * here in step 3.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  // Local mode: no Supabase configured yet — skip auth entirely.
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    return supabaseResponse;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Do not remove: getUser() revalidates the token and triggers the cookie
  // refresh above when it has expired.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  // /pricing stays public: prospective customers — and payment providers
  // reviewing the site — must be able to see what is sold and for how much
  // without creating an account.
  const isProtected = ["/dashboard", "/vehicles", "/copilot", "/security"].some(
    (p) => path === p || path.startsWith(`${p}/`)
  );
  const isAuthPage = path === "/login" || path === "/signup";

  if (!user && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // A session that has passed the password but not the 6-digit code is only
  // half authenticated. The database refuses it either way (migration 0010),
  // so this is about not showing a broken, empty app.
  let mfaPending = false;
  if (user) {
    const { data: aal } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    mfaPending = Boolean(
      aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2"
    );
  }

  if (user && mfaPending && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  // Note the mfaPending guard: without it, a user waiting to type their code
  // would be bounced from /login to /dashboard and back forever.
  if (user && !mfaPending && isAuthPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
