# Fleet Wise email setup (Resend)

Fleet Wise sends two **different kinds** of email through two different paths.
Both need to be pointed at Resend, and they are configured in different places.

| Kind | Examples | Sent by | Configured in |
|---|---|---|---|
| **Auth** | verification, password reset, magic link, email change | **Supabase** | Supabase dashboard → SMTP settings |
| **Product** | maintenance reminders, future receipts | **this app** (`src/lib/email.ts`) | `RESEND_API_KEY` env var |

---

## Prerequisite: a verified domain

Resend will not send from a `@gmail.com` address. Without a verified domain
you can only send to the address that owns the Resend account, which is fine
for a first test but useless for real users.

1. Buy a domain (e.g. `fleetwiseai.com`).
2. Resend → **Domains → Add Domain** → enter it.
3. Resend shows DNS records (DKIM, SPF, and usually DMARC). Add each one at
   your registrar's DNS panel.
4. Wait for Resend to show **Verified** (usually minutes, sometimes hours).

Only then will mail from `hello@yourdomain` actually arrive.

---

## 1 · Auth emails — Supabase SMTP

Supabase sends these, so it needs Resend's SMTP credentials.

Supabase dashboard → **Project Settings → Authentication → SMTP Settings**
(or the "Set up SMTP" banner on the Emails page):

| Field | Value |
|---|---|
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | your Resend API key (`re_...`) |
| Sender email | `hello@yourdomain` (must be on the verified domain) |
| Sender name | `Fleet Wise` |

Save. This also **unlocks template editing** — Supabase locks the templates
until custom SMTP is configured.

Then paste each template in this folder into
**Authentication → Emails → Templates**:

| File | Supabase template | Suggested subject |
|---|---|---|
| `confirm-signup.html` | Confirm sign up | Welcome to Fleet Wise — confirm your email |
| `reset-password.html` | Reset password | Reset your Fleet Wise password |
| `magic-link.html` | Magic Link | Your Fleet Wise sign-in link |
| `change-email.html` | Change Email Address | Confirm your new email address |

Keep every placeholder (`{{ .ConfirmationURL }}`, `{{ .TokenHash }}`,
`{{ .SiteURL }}`) exactly as written — Supabase replaces them with real values.

> **`confirm-signup.html` is different on purpose.** Its button points at
> `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`, not at
> `{{ .ConfirmationURL }}`. The default link uses PKCE, which only completes in
> the same browser that signed up — people who sign up on a laptop and open
> the email on their phone would get an error. The `token_hash` form is
> exchanged for a session by our own route handler and works on any device.

Also set **Authentication → URL Configuration → Site URL** to your live domain,
or the links in these emails will point at the wrong place.

### Turn email confirmation back on

It was switched off during development. Once SMTP works:
**Authentication → Sign In / Providers → Confirm email → ON**.
Without it, anyone can register using an email address they do not own.

---

## 2 · Product emails — this app

Set these environment variables in Vercel (Settings → Environment Variables),
then redeploy:

```
RESEND_API_KEY=re_...            # mark Sensitive
EMAIL_FROM=hello@yourdomain
EMAIL_FROM_NAME=Fleet Wise       # optional, this is the default
EMAIL_REPLY_TO=you@yourdomain    # optional
```

`src/lib/email.ts` prefers Resend whenever `RESEND_API_KEY` is present and
falls back to Brevo otherwise, so setting the key is the whole switch — no
code change needed.

### Verify it works

Sign in and press **"Email me a test reminder"** on the dashboard. It sends
the real maintenance reminder to your own address and reports the exact
provider error if anything fails.

---

## Updating the logo URL

The templates load the logo from `https://fleet-wise-delta.vercel.app/logo.png`.
Once your custom domain is live, replace that URL in all four files with
`https://yourdomain/logo.png` and re-paste them into Supabase.

---

## 3 · Two-factor authentication

Nothing to configure — TOTP is on by default in Supabase and users enrol
themselves at **/security**. Two things are worth knowing:

- **Run `supabase/migrations/0010_require_mfa.sql`.** Without it, 2FA is
  cosmetic: a session that has passed the password but not the code would
  still be accepted by the database.
- **If a user loses their phone**, they are locked out. Remove their factor
  in the dashboard: **Authentication → Users → (the user) → Delete factor**.
  Verify who you are talking to first — this is the one step that undoes 2FA.
