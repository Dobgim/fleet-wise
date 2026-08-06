-- Photo scanning becomes a paid feature with a daily count.
--
--   Free      no scans at all — the upgrade prompt is the feature
--   Premium   3 per day
--   Business  5 per day
--
-- Counted per day rather than per rolling 24 hours, matching the token
-- budget that already resets at UTC midnight. One clock is easier to explain
-- than two ("resets at midnight" beats "resets 24h after whichever scan you
-- happened to run first"), and the reset time is returned so the interface
-- can say exactly when.
--
-- Vision is the most expensive call the product makes — roughly five times a
-- chat question — so this is also what stops one enthusiastic free account
-- spending the whole AI budget on photographs.

alter table public.ai_token_usage
  add column if not exists scan_count integer not null default 0;

comment on column public.ai_token_usage.scan_count is
  'Photo scans claimed by this org today. Written only by claim_scan()/release_scan().';

-- Keep in sync with SCAN_LIMITS in src/lib/plans.ts. Postgres is the
-- authority: the browser can be edited and this cannot.
create or replace function public.scan_limit_for_plan(p_plan text)
returns integer
language sql immutable
as $$
  select case p_plan
    when 'business' then 5
    when 'pro' then 3
    else 0
  end;
$$;

/*
 * Take one scan from today's allowance, or refuse.
 *
 * The claim is the INSERT ... ON CONFLICT DO UPDATE ... WHERE below, which
 * is atomic: two scans started at the same instant cannot both read "2 used"
 * and both proceed. Whichever loses the race gets no row back and is
 * refused. Checking first and incrementing after would let a user with three
 * tabs open have five scans on a three-scan plan.
 */
create or replace function public.claim_scan()
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_org uuid := current_org();
  v_day date := (now() at time zone 'utc')::date;
  v_plan text;
  v_limit integer;
  v_used integer;
  v_resets timestamptz := ((v_day + 1)::timestamptz);
begin
  if not mfa_satisfied() then
    raise exception 'Two-factor authentication required' using errcode = '42501';
  end if;

  if v_org is null then
    return jsonb_build_object('allowed', false, 'reason', 'no_org',
      'limit', 0, 'used', 0, 'remaining', 0, 'plan', 'free',
      'resets_at', v_resets);
  end if;

  v_plan := effective_plan(v_org);
  v_limit := scan_limit_for_plan(v_plan);

  -- Free: refused before any row is touched, so a free org never even
  -- appears in the usage table for scans it was never allowed to make.
  if v_limit <= 0 then
    return jsonb_build_object('allowed', false, 'reason', 'plan',
      'limit', 0, 'used', 0, 'remaining', 0, 'plan', v_plan,
      'resets_at', v_resets);
  end if;

  insert into ai_token_usage (org_id, day, scan_count)
  values (v_org, v_day, 1)
  on conflict (org_id, day) do update
    set scan_count = ai_token_usage.scan_count + 1,
        updated_at = now()
    where ai_token_usage.scan_count < v_limit
  returning scan_count into v_used;

  -- No row back means the WHERE failed: today's allowance is spent.
  if v_used is null then
    select scan_count into v_used
      from ai_token_usage where org_id = v_org and day = v_day;
    return jsonb_build_object('allowed', false, 'reason', 'quota',
      'limit', v_limit, 'used', coalesce(v_used, v_limit), 'remaining', 0,
      'plan', v_plan, 'resets_at', v_resets);
  end if;

  return jsonb_build_object('allowed', true,
    'limit', v_limit, 'used', v_used,
    'remaining', greatest(0, v_limit - v_used),
    'plan', v_plan, 'resets_at', v_resets);
end;
$$;

/*
 * Give a claimed scan back.
 *
 * Called when the AI provider fails. On a three-a-day allowance, losing one
 * to someone else's outage is the difference between a limit and a
 * grievance. Floors at zero so a double release cannot mint scans.
 */
create or replace function public.release_scan()
returns void
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_org uuid := current_org();
  v_day date := (now() at time zone 'utc')::date;
begin
  if v_org is null then return; end if;
  update ai_token_usage
     set scan_count = greatest(0, scan_count - 1),
         updated_at = now()
   where org_id = v_org and day = v_day;
end;
$$;

revoke all on function public.claim_scan() from public;
revoke all on function public.release_scan() from public;
revoke all on function public.scan_limit_for_plan(text) from public;
grant execute on function public.claim_scan() to authenticated;
grant execute on function public.release_scan() to authenticated;
grant execute on function public.scan_limit_for_plan(text) to authenticated;

-- Budget payload gains the scan allowance, so the interface can disable the
-- button and show what is left from the same source that enforces it.
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
  v_scans integer;
  v_scan_limit integer;
begin
  if v_org is null then
    return jsonb_build_object('limit', 0, 'used', 0, 'remaining', 0,
                              'requests', 0, 'plan', 'free',
                              'vehicleLimit', free_vehicles(),
                              'freeVehicles', free_vehicles(),
                              'seats', null,
                              'scanLimit', 0, 'scansUsed', 0,
                              'scansRemaining', 0,
                              'resets_at', ((v_day + 1)::timestamptz));
  end if;

  v_eff := effective_plan(v_org);
  v_limit := ai_token_limit(v_eff);
  v_scan_limit := scan_limit_for_plan(v_eff);

  select seats into v_seats from organizations where id = v_org;

  select tokens_used, request_count, scan_count
    into v_used, v_requests, v_scans
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
    'scanLimit', v_scan_limit,
    'scansUsed', coalesce(v_scans, 0),
    'scansRemaining', greatest(0, v_scan_limit - coalesce(v_scans, 0)),
    'resets_at', ((v_day + 1)::timestamptz)
  );
end;
$$;
