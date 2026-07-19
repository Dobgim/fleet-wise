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
