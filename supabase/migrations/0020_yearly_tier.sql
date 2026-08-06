-- A fourth tier, and Business drops to $18.
--
--   Free       2 vehicles    no scans
--   Premium    $5/vehicle    3 scans/day
--   Business   $18/month     20 vehicles, 5 scans/day
--   Yearly     $199/year     50 vehicles, 10 scans/day
--
-- Yearly is a superset of Business rather than merely the same plan billed
-- annually: paying twelve months up front is worth more than twelve monthly
-- payments, so it buys more room as well as a discount.

-- The plan column has been constrained to three values since 0001. Both
-- tables need widening before anything can be written with the new one.
alter table public.organizations drop constraint if exists organizations_plan_check;
alter table public.organizations
  add constraint organizations_plan_check
  check (plan in ('free', 'pro', 'business', 'yearly'));

alter table public.subscriptions drop constraint if exists subscriptions_plan_check;
alter table public.subscriptions
  add constraint subscriptions_plan_check
  check (plan in ('free', 'pro', 'business', 'yearly'));

create or replace function public.effective_plan(org uuid)
returns text
language sql stable security definer
set search_path = public
as $$
  select case
    when o.plan in ('pro', 'business', 'yearly') then o.plan
    else 'free'
  end
  from organizations o
  where o.id = org;
$$;

-- Vehicles allowed:
--   free      the 2 included
--   pro       the 2 included plus every vehicle paid for
--   business  20
--   yearly    50
create or replace function public.vehicle_limit_for_org(org uuid)
returns integer
language sql stable security definer
set search_path = public
as $$
  select case public.effective_plan(org)
    when 'yearly' then 50
    when 'business' then 20
    when 'pro' then public.free_vehicles()
                    + greatest(0, coalesce((select seats from organizations where id = org), 0))
    else public.free_vehicles()
  end;
$$;

-- Keep in sync with SCAN_LIMITS in src/lib/plans.ts.
create or replace function public.scan_limit_for_plan(p_plan text)
returns integer
language sql immutable
as $$
  select case p_plan
    when 'yearly' then 10
    when 'business' then 5
    when 'pro' then 3
    else 0
  end;
$$;

-- Fair-use ceilings. A runaway guard, not a paywall, and never shown as a
-- number in the interface. Yearly gets headroom proportional to its fleet.
create or replace function public.ai_token_limit(p_plan text)
returns integer
language sql immutable
as $$
  select case p_plan
    when 'yearly' then 400000
    when 'business' then 150000
    when 'pro' then 50000
    else 15000
  end;
$$;

revoke all on function public.vehicle_limit_for_org(uuid) from public;
revoke all on function public.scan_limit_for_plan(text) from public;
grant execute on function public.vehicle_limit_for_org(uuid) to authenticated;
grant execute on function public.scan_limit_for_plan(text) to authenticated;
