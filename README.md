# Fleet Wise — AI Fleet Maintenance Copilot

B2B SaaS that helps fleet operators (delivery, taxi, logistics, construction,
rental) make smarter maintenance decisions: vehicle + service-record tracking, a
cost/maintenance dashboard, and an AI copilot grounded in the org's own data.

## Stack

- **Frontend:** Next.js (App Router) + React + TypeScript + Tailwind CSS
- **Auth:** Clerk (sign-in, email verification, 2FA) — see `CLERK-SETUP.md`
- **Backend/DB:** Supabase (Postgres, Storage) with Row-Level Security as the
  tenant-isolation source of truth, trusting Clerk session tokens
- **Payments:** Paddle subscriptions (merchant of record)
- **Email:** Resend · **Analytics:** PostHog · **Hosting:** Vercel + Supabase

## Setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Set up Clerk** — follow `CLERK-SETUP.md` end to end. Nothing signs in
   until Clerk is connected to Supabase as a third-party auth provider.

3. **Create a Supabase project** at [supabase.com](https://supabase.com), then
   copy the env template and fill in the values from *Project Settings → API*:

   ```bash
   cp .env.example .env.local
   ```

   `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS. It is server-only — never prefix
   it with `NEXT_PUBLIC_` or import it in client code.

4. **Run migrations** with the Supabase CLI:

   ```bash
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push          # applies /supabase/migrations
   npx supabase db seed          # optional sample data
   ```

5. **Run the dev server**

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

Identity is Clerk's; authorization is Postgres's. Clerk user IDs are text
(`user_2abc…`), so policies read `auth.jwt() ->> 'sub'` — `auth.uid()` returns
null under Clerk and must never be used.

### Two-factor authentication

Users enrol an authenticator app at **/security** (Clerk's own UI, which also
covers backup codes and self-service recovery). It is optional, but once
enrolled it cannot be bypassed: migration `0011` keeps a RESTRICTIVE policy on
every table requiring the token's `fva` claim to prove a second factor was
verified, for any user whose `profiles.mfa_enabled` is true. Hiding pages in
the app would not be enough — a stolen token can be pointed straight at the
REST API.

`profiles.mfa_enabled` is written only by the service role, in the Clerk
webhook. A user who could edit their own flag could switch off their own
protection.

### Email verification

Handled by Clerk, from its own sending domain. There is no confirmation route
in this codebase any more.
