-- Attribute a Whop payment to the garage that made it, without trusting Whop
-- to hand the information back.
--
-- The bug this fixes: createCheckoutSession() sent org_id, plan and seats as
-- top-level `metadata` on the checkout configuration — the field Whop's own
-- docs describe as "custom key-value metadata to attach to the checkout
-- configuration". Whop accepts the request, returns 200, and silently drops
-- it: the create response and a subsequent GET both come back with
-- "metadata": null, while `redirect_url` sent in the same request persists.
-- Verified against the live sandbox API across three body shapes.
--
-- The consequence in production would be silent and expensive. The webhook
-- reads metadata.org_id to decide whose plan to upgrade; with metadata gone it
-- logs "membership without org_id" and returns 200. Whop considers the event
-- delivered, the customer's card is charged, and they stay on Free.
--
-- So the mapping is kept here instead. Whop does reliably put
-- checkout_configuration_id on the membership ("the ID of the checkout
-- session/configuration that produced this membership"), and that id is
-- enough to look up what we already knew when we created the session.
--
-- This is also the safer design regardless of the bug: plan and seat count
-- are written by our server at session-creation time and never make a round
-- trip through a third party, so nothing a customer or Whop sends can inflate
-- them.

create table if not exists public.whop_checkouts (
  -- Whop's checkout configuration id (ch_...), which comes back on the
  -- membership as checkout_configuration_id.
  session_id text primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  plan text not null check (plan in ('pro', 'business', 'yearly')),
  -- Vehicle allowance bought, for per-vehicle plans. Null for flat-rate ones.
  seats integer,
  -- What we expected to charge, kept for reconciling against Whop's receipts.
  price numeric(10, 2),
  created_at timestamptz not null default now()
);

create index if not exists whop_checkouts_org_idx
  on public.whop_checkouts (org_id);

comment on table public.whop_checkouts is
  'Server-side record of what each Whop checkout session was for. The webhook resolves membership.checkout_configuration_id against this, because Whop silently drops the metadata sent when creating the session.';

-- No policies are created, so with RLS on, the anon and authenticated roles
-- can read and write nothing here. Only the service role — used by the
-- checkout route and the webhook, both server-only — bypasses RLS. A customer
-- who could edit this table could grant themselves any plan.
alter table public.whop_checkouts enable row level security;
