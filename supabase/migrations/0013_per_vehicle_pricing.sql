-- Per-vehicle pricing, matching how the whole category prices.
--
--   Free      first 3 vehicles, forever, no card
--   Premium   $5 per month for each vehicle beyond the third
--   Business  $20 per month flat, unlimited vehicles
--
-- Two changes of substance:
--
-- 1. The 14-day trial is gone. A permanent 3-vehicle free tier does the same
--    job better: it never expires, so there is no cliff to manage and no
--    reason to rush a decision. Free is now a real product, not a taster.
--
-- 2. Token budgets stop being a product feature and become a fair-use
--    backstop. "3,000 AI tokens a day" tells a fleet manager nothing, and
--    made the product read as a tech demo rather than a business tool. The
--    ceilings below are raised so ordinary use never meets them; they exist
--    only to stop a runaway loop from spending the operator's credit.
--
-- The vehicle allowance is still enforced by the trigger from 0012 — with
-- per-vehicle billing, an unenforced cap is unpaid revenue.

-- Vehicles included at no charge on every plan, including paid ones. A
-- customer with 5 vehicles pays for 2.
create or replace function public.free_vehicles()
returns integer language sql immutable as $$ select 3; $$;

-- Entitlement in force. 'free' is a plan now, not a lapsed state, so there
-- is no longer a 'trial' or 'none'.
create or replace function public.effective_plan(org uuid)
returns text
language sql stable security definer
set search_path = public
as $$
  select case
    when o.plan in ('pro', 'business') then o.plan
    else 'free'
  end
  from organizations o
  where o.id = org;
$$;

-- Fair-use ceilings. Deliberately far above normal use: these are a runaway
-- guard, not a paywall, and are never shown as a number in the interface.
create or replace function public.ai_token_limit(p_plan text)
returns integer
language sql immutable
as $$
  select case p_plan
    when 'business' then 150000
    when 'pro' then 50000
    else 15000              -- free: comfortable for three vehicles
  end;
$$;

-- Vehicles allowed:
--   free      the 3 included
--   pro       the 3 included plus every vehicle paid for
--   business  unlimited
create or replace function public.vehicle_limit_for_org(org uuid)
returns integer
language sql stable security definer
set search_path = public
as $$
  select case public.effective_plan(org)
    when 'business' then null
    when 'pro' then public.free_vehicles()
                    + greatest(0, coalesce((select seats from organizations where id = org), 0))
    else public.free_vehicles()
  end;
$$;

revoke all on function public.free_vehicles() from public;
grant execute on function public.free_vehicles() to authenticated;

-- Budget payload: same shape, minus the trial, plus what the UI needs to
-- explain the free allowance without a second round trip.
create or replace function public.get_ai_budget()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_org uuid := current_org();
  v_day date := (now() at time zone 'utc')::date;
  v_eff text;
  v_limit integer;
  v_used integer;
  v_requests integer;
  v_seats integer;
begin
  if v_org is null then
    return jsonb_build_object('limit', 0, 'used', 0, 'remaining', 0,
                              'requests', 0, 'plan', 'free',
                              'vehicleLimit', free_vehicles(),
                              'freeVehicles', free_vehicles(),
                              'seats', null,
                              'resets_at', ((v_day + 1)::timestamptz));
  end if;

  v_eff := effective_plan(v_org);
  v_limit := ai_token_limit(v_eff);

  select seats into v_seats from organizations where id = v_org;

  select tokens_used, request_count into v_used, v_requests
  from ai_token_usage where org_id = v_org and day = v_day;

  return jsonb_build_object(
    'limit', v_limit,
    'used', coalesce(v_used, 0),
    'remaining', greatest(0, v_limit - coalesce(v_used, 0)),
    'requests', coalesce(v_requests, 0),
    'plan', v_eff,
    'vehicleLimit', vehicle_limit_for_org(v_org),
    'freeVehicles', free_vehicles(),
    'seats', v_seats,
    'resets_at', ((v_day + 1)::timestamptz)
  );
end;
$$;

-- trial_ends_at is left in place but no longer consulted: dropping a column
-- is irreversible, and it costs nothing to keep should a trial return.
comment on column public.organizations.trial_ends_at is
  'Unused since 0013 — superseded by the permanent 3-vehicle free tier.';

comment on column public.organizations.seats is
  'Premium only: vehicles PAID FOR, i.e. beyond the free three. Mirrors the Paddle subscription quantity.';
