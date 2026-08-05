# Paddle setup for the new pricing

New pricing, effective with migration `0013_per_vehicle_pricing.sql`:

| Plan | Price | Vehicles |
|---|---|---|
| **Free** | $0 forever, no card | **2** |
| **Premium** | **$5 per vehicle / month** beyond the first two | unlimited |
| **Business** | **$20 / month** flat | unlimited |

A fleet of 5 pays for 3 vehicles = $15/month. Business becomes cheaper at 7
vehicles and up.

**AI token numbers are no longer shown anywhere.** They still exist as a
fair-use backstop against runaway automated use, but "3,000 tokens a day"
means nothing to a fleet manager pricing you against $5/vehicle competitors,
and made a business tool read as a tech demo. The ceilings were raised so
ordinary use never meets them.

The 14-day trial is gone — a permanent 3-vehicle free tier does the same job
without a cliff.

---

## 1 · Change the Business price to $20

Paddle → **Catalog → Products → MotorWise Business → Prices**.

Paddle prices are **immutable in the ways that matter** — you cannot edit the
amount of a price that has been used. Create a new one:

1. **New price** → amount **$20.00**, billing period **monthly**.
2. Archive the old $100 price so nobody can buy it again.
3. Copy the new price ID (`pri_…`).

## 2 · Create the Premium per-vehicle price

Paddle → **Catalog → Products → MotorWise Premium → New price**.

| Field | Value |
|---|---|
| Description | Premium — per vehicle |
| Amount | **5.00** USD |
| Billing period | Monthly |
| **Quantity** | Minimum **1**, maximum **1000** |

The quantity range is what makes per-vehicle billing work: the checkout sends
the number of **billable** vehicles as the quantity, and Paddle multiplies.
Paddle defaults this to **1–100**, so raise the maximum — otherwise a fleet of
more than 101 vehicles cannot check out.

**Quantity = total vehicles − 2.** The free vehicles are subtracted by this
app before the number ever reaches Paddle, so Paddle only ever sees what is
actually charged for. `organizations.seats` stores the same number: a
5-vehicle fleet buys quantity 3 and pays $15.

Archive the old flat $20 Premium price.

## 3 · Update the price IDs

`.env.local` **and** Vercel → Settings → Environment Variables:

```
NEXT_PUBLIC_PADDLE_PRICE_PRO=pri_...        # the new $5 per-vehicle price
NEXT_PUBLIC_PADDLE_PRICE_BUSINESS=pri_...   # the new $20 flat price
```

Redeploy afterwards — these are `NEXT_PUBLIC_`, so they are baked in at build
time and a saved variable alone changes nothing.

## 4 · Run the migrations

Supabase → SQL Editor → run **in order**: `0012_trial_and_seats.sql`, then
`0013_per_vehicle_pricing.sql`, then
`0014_free_one_vehicle_and_mfa_fix.sql`.

0012 creates the `seats` column and the enforcement trigger, 0013 switches to
per-vehicle pricing, and 0014 sets the free allowance to one vehicle and
repairs `mfa_satisfied()`. **Never replay 0010 afterwards** — it reinstates an
`auth.uid()` version of that function that breaks every table under Clerk.

Together they add `seats` to `organizations`, rewrite the limit functions, and
add a **trigger that enforces the vehicle cap in the database**. That trigger
matters more than it used to: with per-vehicle pricing, an unenforced cap is
unpaid revenue.

---

## What happens to existing subscribers

Anyone already on the old $100 Business or flat $20 Premium keeps paying the
old amount until you move them. Paddle does not reprice existing subscriptions
when you archive a price.

You have one sandbox subscriber (yourself), so the simple answer is to cancel
it in the Paddle sandbox and re-subscribe at the new prices.

## How subscription changes work now

- **First purchase** → Paddle-hosted checkout, with the vehicle count as the
  quantity.
- **Adding a vehicle when full** → the Vehicles page offers
  "Add a vehicle to my plan (+$5/mo)". It calls
  `POST /api/subscription` twice: once with `preview: true` to get the exact
  prorated amount, then again to apply it after the user confirms.
- **Switching plans** → the Pricing page does the same preview-then-apply.
  It never opens a second checkout, which would create a second subscription
  and bill the customer twice.
- **Cancelling / changing card** → the manage-subscription link in Paddle's
  receipt email.

`seats` in the database mirrors the Paddle quantity, and the Paddle webhook is
the authority: however a subscription changes — through this app, Paddle's own
portal, or support acting manually — the webhook writes back what was actually
paid for, and the trigger enforces exactly that.

## Testing

Use Paddle's sandbox card `4242 4242 4242 4242`, any future expiry, any CVC.

1. Sign up → Free plan, 2 vehicles allowed, no card asked for.
2. Add two vehicles → the 3rd is refused with a link to pricing.
3. Buy Premium for a 5-vehicle fleet → Paddle quantity **3**, charge $15 →
   `organizations.seats` becomes 3 and `vehicle_limit_for_org` returns 5.
4. Add a 6th vehicle → prompt shows the prorated amount → confirm → `seats`
   becomes 4, the vehicle saves.
5. Switch to Business → prompt shows the difference → `seats` becomes null,
   vehicles unlimited.
6. Confirm no token counts appear anywhere in the interface.

---

## Beta mode — running free before revenue

Vercel's Hobby plan is licensed for **non-commercial use only**, so taking a
payment means upgrading to Pro at $20/month. Until there is revenue to cover
that, billing stays off.

The switch is a **database row**, not an environment variable, because it has
to govern two things that must never disagree: what the pricing page offers,
and what the vehicle-limit trigger allows. Hiding the checkout button alone
would leave beta users capped at one vehicle with no way to add a second.

```sql
-- start charging
update public.app_config set beta_mode = false;

-- go back to free
update public.app_config set beta_mode = true;

-- change how many vehicles the beta allows
update public.app_config set beta_vehicle_limit = 5;
```

While `beta_mode` is true:

| | Beta | Live |
|---|---|---|
| Free vehicles | `beta_vehicle_limit` (1) | 2 |
| Free AI fair-use | 50,000/day | 15,000/day |
| Pricing page | plans shown, "Free during beta" | checkout buttons |
| Paddle | untouched and still wired | charges |

Nothing about the Paddle integration is removed or disabled — prices,
webhook and the subscription-update endpoint stay exactly as they are, so
turning billing on is one `UPDATE` and no redeploy.

**Before flipping it off**, remember what becomes true the moment money moves:

- Vercel must be on **Pro** ($20/month) — a licensing requirement
- Supabase Free has **no daily backups**; $25/month buys them, and paying
  customers' maintenance history is not something to hold without backups
- Paddle takes **5% + $0.50 per transaction**, which on a $5 subscription is
  15% — worth offering annual billing before leaning on the $5 price point
