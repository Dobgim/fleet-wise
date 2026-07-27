# Paddle setup for the new pricing

New pricing, effective with migration `0012_trial_and_seats.sql`:

| Plan | Price | Vehicles | AI tokens/day |
|---|---|---|---|
| **Free trial** | $0 for 14 days, no card | 20 | 30,000 |
| **Premium** | **$5 per vehicle** / month | as many as paid for | 30,000 |
| **Business** | **$20** / month | unlimited | 100,000 |

There is no free plan. When the trial ends, records stay readable but adding
vehicles and using the AI stop until a plan is bought.

---

## 1 · Change the Business price to $20

Paddle → **Catalog → Products → Fleet Wise Business → Prices**.

Paddle prices are **immutable in the ways that matter** — you cannot edit the
amount of a price that has been used. Create a new one:

1. **New price** → amount **$20.00**, billing period **monthly**.
2. Archive the old $100 price so nobody can buy it again.
3. Copy the new price ID (`pri_…`).

## 2 · Create the Premium per-vehicle price

Paddle → **Catalog → Products → Fleet Wise Premium → New price**.

| Field | Value |
|---|---|
| Description | Premium — per vehicle |
| Amount | **5.00** USD |
| Billing period | Monthly |
| **Quantity** | Minimum **1**, maximum **1000** |

The quantity range is what makes per-vehicle billing work: the checkout sends
the number of vehicles as the quantity, and Paddle multiplies. If the maximum
is left at 1, every customer is stuck on one vehicle.

Archive the old flat $20 Premium price.

## 3 · Update the price IDs

`.env.local` **and** Vercel → Settings → Environment Variables:

```
NEXT_PUBLIC_PADDLE_PRICE_PRO=pri_...        # the new $5 per-vehicle price
NEXT_PUBLIC_PADDLE_PRICE_BUSINESS=pri_...   # the new $20 flat price
```

Redeploy afterwards — these are `NEXT_PUBLIC_`, so they are baked in at build
time and a saved variable alone changes nothing.

## 4 · Run the migration

Supabase → SQL Editor → `supabase/migrations/0012_trial_and_seats.sql` → Run.

This adds `trial_ends_at` and `seats` to `organizations`, rewrites the limit
functions, and adds a **trigger that enforces the vehicle cap in the
database**. That trigger matters more than it used to: with per-vehicle
pricing, an unenforced cap is unpaid revenue.

Existing organizations get a fresh 14-day trial from the moment you run it.

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

1. Sign up → banner shows the trial, 20 vehicles allowed.
2. Buy Premium with quantity 2 → `organizations.seats` becomes 2.
3. Add a 3rd vehicle → prompt shows the prorated amount → confirm → `seats`
   becomes 3 and the vehicle saves.
4. Switch to Business → prompt shows the difference → `seats` becomes null,
   vehicles unlimited.
5. In Supabase, set `trial_ends_at` to a past date on a trial org and confirm
   the app locks to read-only.
