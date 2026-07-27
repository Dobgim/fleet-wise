-- New pricing: no free tier, a 14-day trial, and Premium billed per vehicle.
--
--   Premium   $5 per vehicle per month   (Paddle quantity = vehicles paid for)
--   Business  $20 per month, unlimited vehicles
--
-- There is no free plan any more. `plan = 'free'` now means "not paying",
-- which is a state, not a product: during the trial it grants Premium-level
-- access, and after the trial it grants nothing but read access to data the
-- user already entered. Their records are never held hostage — they simply
-- cannot add vehicles or spend AI tokens until they subscribe.
--
-- Per-vehicle billing makes the vehicle cap a revenue control rather than a
-- courtesy, so it is enforced by a trigger below. Until now it lived only in
-- the browser, where anyone could have added a hundred vehicles on a
-- one-vehicle subscription.

alter table public.organizations
  add column if not exists trial_ends_at timestamptz
    not null default (now() + interval '14 days'),
  -- Vehicles paid for on Premium; mirrors the Paddle subscription quantity.
  -- Null on Business (unlimited) and while not subscribed.
  add column if not exists seats integer;

comment on column public.organizations.seats is
  'Premium only: number of vehicles paid for, kept in step with the Paddle subscription quantity.';

-- ------------------------------------------------------- effective access

-- What this organization is actually entitled to right now: 'business',
-- 'pro', 'trial', or 'none'. Everything else keys off this, so the trial and
-- its expiry are decided in exactly one place.
create or replace function public.effective_plan(org uuid)
returns text
language sql stable security definer
set search_path = public
as $$
  select case
    when o.plan in ('pro', 'business') then o.plan
    when o.trial_ends_at > now() then 'trial'
    else 'none'
  end
  from organizations o
  where o.id = org;
$$;

-- Daily AI tokens. The trial deliberately matches Premium: a trial that
-- cannot demonstrate the product does not sell it.
create or replace function public.ai_token_limit(p_plan text)
returns integer
language sql immutable
as $$
  select case p_plan
    when 'business' then 100000
    when 'pro' then 30000
    when 'trial' then 30000
    else 0               -- 'none': trial over, not subscribed
  end;
$$;

-- Vehicles allowed. Premium is whatever was paid for; the trial gets a
-- generous ceiling so a real fleet can be loaded in and evaluated.
create or replace function public.vehicle_limit_for_org(org uuid)
returns integer
language sql stable security definer
set search_path = public
as $$
  select case public.effective_plan(org)
    when 'business' then null                                  -- unlimited
    when 'pro' then greatest(1, coalesce((select seats from organizations where id = org), 1))
    when 'trial' then 20
    else 0
  end;
$$;

revoke all on function public.effective_plan(uuid) from public;
revoke all on function public.vehicle_limit_for_org(uuid) from public;
grant execute on function public.effective_plan(uuid) to authenticated;
grant execute on function public.vehicle_limit_for_org(uuid) to authenticated;

-- ------------------------------------------------- enforce the vehicle cap

create or replace function public.enforce_vehicle_limit()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  lim integer := public.vehicle_limit_for_org(new.org_id);
  used integer;
begin
  if lim is null then
    return new;                              -- Business: unlimited
  end if;

  select count(*) into used from vehicles where org_id = new.org_id;
  if used >= lim then
    -- The app turns this into a plain-English prompt to add a vehicle to the
    -- subscription; the code is what it matches on.
    raise exception 'vehicle_limit_reached (allowed %, used %)', lim, used
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists vehicles_enforce_limit on public.vehicles;
create trigger vehicles_enforce_limit
  before insert on public.vehicles
  for each row execute function public.enforce_vehicle_limit();

-- ---------------------------------------------------------- budget rewrite

-- Same JSON shape as before plus the fields the UI needs to explain itself:
-- which plan is in force, when the trial ends, and how many vehicles are paid
-- for. Adding them here avoids a second round trip on every page load.
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
  v_trial timestamptz;
  v_seats integer;
begin
  if v_org is null then
    return jsonb_build_object('limit', 0, 'used', 0, 'remaining', 0,
                              'requests', 0, 'plan', 'none',
                              'vehicleLimit', 0, 'seats', null,
                              'trialEndsAt', null,
                              'resets_at', ((v_day + 1)::timestamptz));
  end if;

  v_eff := effective_plan(v_org);
  v_limit := ai_token_limit(v_eff);

  select trial_ends_at, seats into v_trial, v_seats
  from organizations where id = v_org;

  select tokens_used, request_count into v_used, v_requests
  from ai_token_usage where org_id = v_org and day = v_day;

  return jsonb_build_object(
    'limit', v_limit,
    'used', coalesce(v_used, 0),
    'remaining', greatest(0, v_limit - coalesce(v_used, 0)),
    'requests', coalesce(v_requests, 0),
    'plan', v_eff,
    'vehicleLimit', vehicle_limit_for_org(v_org),
    'seats', v_seats,
    'trialEndsAt', v_trial,
    'resets_at', ((v_day + 1)::timestamptz)
  );
end;
$$;

-- check_ai_budget keeps its 2FA gate from 0011 and inherits the new limits.
create or replace function public.check_ai_budget()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  if not public.mfa_satisfied() then
    raise exception 'Two-factor authentication required' using errcode = '42501';
  end if;

  v := get_ai_budget();
  return v || jsonb_build_object(
    'allowed', (v->>'remaining')::int >= ai_min_headroom()
  );
end;
$$;

-- The old plan-text vehicle_limit() is superseded by vehicle_limit_for_org(),
-- which needs the org to read its seat count and trial.
drop function if exists public.vehicle_limit(text);
