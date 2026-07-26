-- Retune the plan limits.
--
-- Free becomes a genuine taster rather than a usable free product: one
-- vehicle, 3,000 tokens a day. Premium drops to 20 vehicles and 30,000
-- tokens — still far more than a small fleet needs, and it keeps the cost
-- ceiling well under the subscription price.
--
-- These numbers must stay in step with src/lib/plans.ts, which drives the
-- interface. This function is the authority: the app can be edited by a
-- user, Postgres cannot.

create or replace function public.ai_token_limit(p_plan text)
returns integer
language sql immutable
as $$
  select case p_plan
    when 'free' then 3000
    when 'pro' then 30000
    when 'business' then 100000
    else 3000
  end;
$$;

-- Vehicle ceilings are enforced in the app today. Recording them here too
-- so the database is self-documenting and ready to enforce them server-side
-- when vehicle creation moves behind a function.
create or replace function public.vehicle_limit(p_plan text)
returns integer
language sql immutable
as $$
  select case p_plan
    when 'free' then 1
    when 'pro' then 20
    else null          -- business: unlimited
  end;
$$;

revoke all on function public.vehicle_limit(text) from public;
grant execute on function public.vehicle_limit(text) to authenticated;
