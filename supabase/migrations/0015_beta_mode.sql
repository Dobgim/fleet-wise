-- Beta mode: run free until the first customer is ready to pay.
--
-- Vercel's Hobby plan is licensed for non-commercial use only, so taking a
-- payment means upgrading to Pro at $20/month. Pre-revenue that is the
-- largest line in the budget, so billing stays switched off until it is
-- earned — at which point four paid vehicles cover it.
--
-- The switch lives here rather than in an environment variable because it has
-- to govern two things that must never disagree: what the interface offers,
-- and what the database allows. Hiding the checkout button alone would leave
-- beta users capped at one vehicle with no way to add a second.
--
-- To start charging:  update public.app_config set beta_mode = false;
-- To go back:         update public.app_config set beta_mode = true;

create table if not exists public.app_config (
  -- The `singleton` trick: the primary key can only ever hold true, so a
  -- second configuration row cannot be inserted.
  singleton boolean primary key default true check (singleton),
  beta_mode boolean not null default true,
  -- Vehicles a free account may add while in beta. Generous on purpose: a
  -- beta that cannot hold a real fleet teaches you nothing about the product.
  beta_vehicle_limit integer not null default 25,
  updated_at timestamptz not null default now()
);

insert into public.app_config (singleton) values (true)
on conflict (singleton) do nothing;

alter table public.app_config enable row level security;

-- Readable by signed-in users so the app can explain itself; writable only by
-- the service role, so nobody can grant themselves the beta allowance.
drop policy if exists app_config_read on public.app_config;
create policy app_config_read on public.app_config
  for select to authenticated using (true);

create or replace function public.beta_mode()
returns boolean
language sql stable security definer
set search_path = public
as $$ select coalesce((select beta_mode from app_config limit 1), false); $$;

revoke all on function public.beta_mode() from public;
grant execute on function public.beta_mode() to authenticated;

-- Vehicles included at no charge. In beta everyone gets the beta allowance;
-- afterwards it drops to the one free vehicle the pricing promises.
-- No longer immutable: it reads configuration, so it must be stable.
create or replace function public.free_vehicles()
returns integer
language sql stable security definer
set search_path = public
as $$
  select case
    when public.beta_mode()
      then coalesce((select beta_vehicle_limit from app_config limit 1), 25)
    else 1
  end;
$$;

revoke all on function public.free_vehicles() from public;
grant execute on function public.free_vehicles() to authenticated;

-- Fair-use ceilings. Beta users get the Premium allowance: a trial of the AI
-- that keeps running out is not a trial of the AI.
create or replace function public.ai_token_limit(p_plan text)
returns integer
language sql stable
as $$
  select case p_plan
    when 'business' then 150000
    when 'pro' then 50000
    else case when public.beta_mode() then 50000 else 15000 end
  end;
$$;

-- Budget payload gains the beta flag, so the interface has one source of
-- truth for whether to offer checkout — the same one that sets the limits.
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
                              'seats', null, 'beta', beta_mode(),
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
    'beta', beta_mode(),
    'resets_at', ((v_day + 1)::timestamptz)
  );
end;
$$;
