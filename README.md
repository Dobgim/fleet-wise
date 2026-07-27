# Fleet Wise — AI Fleet Maintenance Copilot

B2B SaaS that helps fleet operators (delivery, taxi, logistics, construction,
rental) make smarter maintenance decisions: vehicle + service-record tracking, a
cost/maintenance dashboard, and an AI copilot grounded in the org's own data.

## Stack

- **Frontend:** Next.js (App Router) + React + TypeScript + Tailwind CSS
- **Backend/DB:** Supabase (Postgres, Auth, Storage, Edge Functions) with
  Row-Level Security as the tenant-isolation source of truth
- **Payments:** Stripe subscriptions (webhook via Edge Function)
- **Email:** Resend · **Analytics:** PostHog · **Hosting:** Vercel + Supabase

## Setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Create a Supabase project** at [supabase.com](https://supabase.com), then
   copy the env template and fill in the values from *Project Settings → API*:

   ```bash
   cp .env.example .env.local
   ```

   `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS. It is server-only — never prefix
   it with `NEXT_PUBLIC_` or import it in client code.

3. **Run migrations** (added in step 2 of the build) with the Supabase CLI:

   ```bash
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push          # applies /supabase/migrations
   npx supabase db seed          # optional sample data
   ```

4. **Run the dev server**

   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000).

## Project structure

```
src/
  app/                  # App Router pages (routes added per feature step)
  lib/
    supabase/
      client.ts         # Browser client (anon key, RLS-scoped)
      server.ts         # Server Components / Actions client (cookie session)
      middleware.ts     # Session refresh helper used by src/middleware.ts
      admin.ts          # Service-role client — trusted server code ONLY
  middleware.ts         # Refreshes auth session on every request
supabase/
  migrations/           # SQL migrations incl. RLS policies (step 2)
```

## Security model

Every row belongs to an organization. RLS policies (step 2) ensure users can
only touch rows for orgs they are members of, checked via `memberships` +
`auth.uid()`. Client-side filtering is never relied on for isolation. The
service-role client is used only in trusted server code (Stripe webhook, AI
functions) and scopes queries by `org_id` manually.

### Two-factor authentication

Users can enrol an authenticator app (Google Authenticator, Authy, 1Password…)
at **/security**. It is optional, but once enrolled it cannot be bypassed:
migration `0010_require_mfa.sql` adds a RESTRICTIVE policy to every table
requiring the JWT to carry `aal2`, and gates the token-spending functions the
same way. Hiding pages in the app would not be enough — a stolen password
yields a valid token that can be pointed straight at the REST API.

The login page therefore has two steps: password, then a 6-digit code. The
middleware bounces half-authenticated sessions back to `/login` so they see
the code box instead of an app with no data in it.

### Email confirmation

New accounts must confirm their address before they get a session
(**Authentication → Sign In / Providers → Confirm email → ON**). The link in
the email points at `/auth/confirm`, which exchanges a one-time `token_hash`
for a session server-side — so it still works when the email is opened on a
different device from the one that signed up, which the default PKCE link
does not.
