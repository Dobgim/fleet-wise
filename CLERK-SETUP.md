# Switching Fleet Wise to Clerk authentication

Clerk is now the identity provider. Supabase still stores all the data and
still decides who may touch it — it simply trusts a Clerk session token
instead of issuing its own.

Do these steps **in order**. Steps 1–4 must all be done before anyone can sign
in; the app will be broken in between, which is expected.

---

## 1 · Create the Clerk application

1. Sign up at [clerk.com](https://clerk.com) and create an application.
2. Name it **Fleet Wise**.
3. Under **sign-in options**, enable **Email** and **Password**. Turn on
   **Email verification code** — this replaces the Supabase confirmation email
   that never reliably delivered, and it sends from Clerk's own warmed domain,
   so there is nothing for you to configure and nothing to land in spam.
4. Leave social logins off for now unless you want Google sign-in; it can be
   added later without code changes.

## 2 · Copy the API keys

Clerk dashboard → **API keys** → Next.js. Add to `.env.local` **and** to
Vercel (Settings → Environment Variables):

```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...          # mark Sensitive in Vercel

# Keep Clerk's redirects on the URLs this app already uses
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/login
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/signup
NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/dashboard
NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/dashboard
```

Use the `pk_test_`/`sk_test_` keys while testing. Clerk gives you separate
production keys when you add a custom domain — swap them then, **and update
the Clerk domain in Supabase (step 3) at the same time**. A production
instance has a different domain (`clerk.yourdomain.com`); if Supabase is left
pointing at the development one it will reject every signed-in user.

## 3 · Connect Clerk to Supabase

This is the step that makes Supabase accept Clerk's tokens.

1. Go straight to **https://dashboard.clerk.com/setup/supabase**, pick your
   Fleet Wise instance, then click **Activate Supabase integration**.
   The **Clerk domain** is only revealed *after* you activate — it looks like
   `https://verb-noun-42.clerk.accounts.dev`. Copy it including `https://`.
   (Same value as **Frontend API URL** on the API keys page.)
2. **Supabase dashboard → Authentication → Sign In / Providers → Add provider
   → Clerk.** Paste the domain. Save.

Supabase now fetches Clerk's public keys and verifies every token itself. No
secret is shared between the two services.

> The old **Clerk JWT template** approach is deprecated (since April 2025).
> If you find a guide telling you to create a JWT template named `supabase`,
> it is out of date — use the integration above.

## 4 · Run the migration

Supabase → **SQL Editor** → paste
`supabase/migrations/0011_clerk_identity.sql` → **Run**.

**This wipes all vehicles, service records, organizations and memberships.**
That is deliberate and was agreed: the old rows are keyed by Supabase user
UUIDs that no longer refer to anybody. Clerk user IDs are text
(`user_2abc…`), not UUIDs, so `auth.uid()` returns null under Clerk — every
identity check had to be rebuilt on `auth.jwt() ->> 'sub'`.

Run `0010_require_mfa.sql` first if you never did; `0011` redefines the parts
of it that changed.

## 5 · Set up the Clerk webhook

The nightly reminder job and the Paddle receipt email both need an email
address for a user, and Postgres needs to know whether a user has 2FA on.
Neither can ask Clerk directly, so Clerk pushes changes to us.

1. Clerk dashboard → **Webhooks → Add Endpoint**.
2. URL: `https://your-domain/api/clerk/webhook`
   (use your Vercel URL until the custom domain lands).
3. Subscribe to: **user.created**, **user.updated**, **user.deleted**.
4. Copy the **Signing Secret** and add it to `.env.local` and Vercel:

```
CLERK_WEBHOOK_SIGNING_SECRET=whsec_...   # mark Sensitive
```

Without this, reminder emails silently find no recipient and the 2FA policy
treats everyone as having 2FA off.

> **Existing users won't have a profile row.** The webhook only fires on
> change. After signing up, open Clerk → Users → your user → and hit **Save**
> once to fire a `user.updated`, or simply sign up fresh — the clean slate in
> step 4 means everyone is new anyway.

## 6 · Verify

```bash
npm run dev
```

Then check, in this order:

| # | Test | Expected |
|---|---|---|
| 1 | Open `/dashboard` signed out | Redirected to `/login` |
| 2 | Sign up at `/signup` | Clerk asks for an email code; the code arrives |
| 3 | After verifying | Landed on `/dashboard`, a garage was created |
| 4 | Supabase → Table Editor → `profiles` | One row, with your email |
| 5 | Add a vehicle | Saves; visible after a refresh |
| 6 | `/security` → Security → add authenticator app | QR code, then backup codes |
| 7 | Sign out, sign back in | Asked for the 6-digit code |
| 8 | Supabase → `profiles` | `mfa_enabled` is now `true` |

If step 5 fails with a permissions error, the token is not being accepted —
recheck step 3. If step 8 stays `false`, the webhook is not arriving — check
Clerk → Webhooks → your endpoint → **Message attempts** for the error.

---

## What this replaced

- Supabase Auth sign-up/sign-in, and the `/auth/confirm` route
- The hand-built 2FA enrolment and challenge screens
- The password show/hide toggle — Clerk's own password field has one built in
- `src/lib/auth-errors.ts` — Clerk writes its own error messages

## What did **not** change

Tenant isolation still lives in Postgres RLS, and 2FA is still enforced there
rather than in the app: if `profiles.mfa_enabled` is true, every policy demands
the token's `fva` claim prove a second factor was verified. A stolen token
pointed straight at the REST API still gets nothing.

## Cost

Free to 10,000 monthly active users, then $25/month plus usage. Supabase Auth
was free at any volume — this is what the switch costs once you grow.
