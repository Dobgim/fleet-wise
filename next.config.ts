import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A stray lockfile exists in the user profile folder; pin the root here.
  turbopack: {
    root: path.join(__dirname),
  },

  // Don't advertise the framework to attackers.
  poweredByHeader: false,

  // Security headers on every response. No Content-Security-Policy yet: the
  // pages load Clerk and Whop's checkout embed from their own domains, and a
  // CSP tight enough to matter has to be built against those and verified in
  // a browser — a wrong one silently breaks sign-in or payment. The headers
  // below need no allowlist and carry no such risk.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Force HTTPS for two years, including subdomains. Only sent over
          // HTTPS, so it cannot lock anyone out over plain HTTP.
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          // Clickjacking: the app must never be framed by another SITE.
          // SAMEORIGIN not DENY so any same-origin frame (e.g. an auth flow)
          // keeps working while cross-origin framing is still blocked.
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          // Stop browsers guessing content types (MIME sniffing).
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Don't leak full URLs (which can carry ids) to other origins.
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          // Deny powerful APIs the app does not use. payment is deliberately
          // NOT denied: Whop's checkout embed uses the Payment Request API
          // for Apple/Google Pay, and blocking it would break express
          // checkout inside its iframe.
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
