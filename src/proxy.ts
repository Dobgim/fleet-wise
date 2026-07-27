import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

/**
 * Clerk runs on every request, reads the session, and guards the private
 * routes.
 *
 * /pricing stays public: prospective customers — and payment providers
 * reviewing the site — must be able to see what is sold and for how much
 * without creating an account.
 */
const isProtectedRoute = createRouteMatcher([
  "/dashboard(.*)",
  "/vehicles(.*)",
  "/copilot(.*)",
  "/security(.*)",
]);

export default clerkMiddleware(async (auth, request) => {
  if (!isProtectedRoute(request)) return;

  const { userId } = await auth();
  if (!userId) {
    // Deliberately not auth.protect(): in Next 16's proxy it redirects to the
    // current URL instead of the sign-in page, which silently defeats the
    // guard. Building the redirect by hand avoids that.
    const url = new URL("/login", request.url);
    url.searchParams.set("redirect_url", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
});

export const config = {
  matcher: [
    // Everything except Next internals and static assets…
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // …plus API routes, so handlers always see the session…
    "/(api|trpc)(.*)",
    // …plus Clerk's own frontend API paths.
    "/__clerk/(.*)",
  ],
};
