-- End the beta. Billing is live.
--
-- Beta mode existed for one reason: Vercel's Hobby plan forbids commercial
-- use, so charging money there meant $20/month before the first customer.
-- MotorWise now runs on Cloudflare Workers, whose free tier permits
-- commercial use, so the reason is gone.
--
-- The whole switch is removed rather than merely turned off. A dormant
-- `beta_mode()` returning false is a second definition of the free allowance
-- waiting to disagree with plans.ts, and every reader of it has to keep
-- asking a question whose answer can no longer change.

-- Two vehicles free, then $5 each. Matches FREE_VEHICLES in src/lib/plans.ts;
-- Postgres is the authority, because the browser can be edited and this
-- cannot.
create or replace function public.free_vehicles()
returns integer
language sql immutable
set search_path = public
as $$ select 2; $$;

revoke all on function public.free_vehicles() from public;
grant execute on function public.free_vehicles() to authenticated;

-- Fair-use ceilings, without the beta branch. Free returns to 15,000/day.
create or replace function public.ai_token_limit(p_plan text)
returns integer
language sql immutable
as $$
  select case p_plan
    when 'business' then 150000
    when 'pro' then 50000
    else 15000
  end;
$$;

-- Budget payload loses the beta flag. Dropping the key rather than sending
-- false keeps the interface from carrying a decision that no longer exists.
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

-- Dropped last: free_vehicles() and ai_token_limit() above depended on it.
drop function if exists public.beta_mode();
drop table if exists public.app_config;
