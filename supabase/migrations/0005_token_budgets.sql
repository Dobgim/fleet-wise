-- Daily token budgets, replacing the monthly question counter.
--
-- Why tokens: a "question" is not a unit of cost. Asking about one vehicle
-- costs a fraction of asking about a fleet of 200, because the whole fleet
-- context is sent with every request. OpenAI reports the exact tokens each
-- call consumed, so we debit the real number and the budget tracks real
-- spend instead of an average guess.
--
-- Budgets reset at UTC midnight: usage is keyed by calendar day, so a new
-- day simply has no row yet.

create table if not exists public.ai_token_usage (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  day date not null,
  tokens_used integer not null default 0,
  request_count integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (org_id, day)
);

create index if not exists ai_token_usage_org_idx on public.ai_token_usage (org_id);

alter table public.ai_token_usage enable row level security;

-- Readable by members; writable only through the functions below.
create policy ai_token_usage_select on public.ai_token_usage
  for select to authenticated using (is_org_member(org_id));

-- Daily token allowance per plan. Keep in sync with src/lib/plans.ts.
create or replace function public.ai_token_limit(p_plan text)
returns integer
language sql immutable
as $$
  select case p_plan
    when 'free' then 5000
    when 'pro' then 50000
    when 'business' then 100000
    else 5000
  end;
$$;

-- A request needs at least this much headroom to start. Without it a user
-- with 10 tokens left could still trigger a full-price call.
create or replace function public.ai_min_headroom()
returns integer language sql immutable as $$ select 600; $$;

-- Current budget for the caller's org.
-- Returns { limit, used, remaining, requests, resets_at }
create or replace function public.get_ai_budget()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_org uuid := current_org();
  v_day date := (now() at time zone 'utc')::date;
  v_plan text;
  v_limit integer;
  v_used integer;
  v_requests integer;
begin
  if v_org is null then
    return jsonb_build_object('limit', 0, 'used', 0, 'remaining', 0,
                              'requests', 0,
                              'resets_at', ((v_day + 1)::timestamptz));
  end if;

  select plan into v_plan from organizations where id = v_org;
  v_limit := ai_token_limit(coalesce(v_plan, 'free'));

  select tokens_used, request_count into v_used, v_requests
  from ai_token_usage where org_id = v_org and day = v_day;
  v_used := coalesce(v_used, 0);
  v_requests := coalesce(v_requests, 0);

  return jsonb_build_object(
    'limit', v_limit,
    'used', v_used,
    'remaining', greatest(0, v_limit - v_used),
    'requests', v_requests,
    'resets_at', ((v_day + 1)::timestamptz)
  );
end;
$$;

-- Pre-flight: may this org start another AI request today?
-- Returns the same shape as get_ai_budget plus { allowed }.
create or replace function public.check_ai_budget()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v jsonb := get_ai_budget();
begin
  return v || jsonb_build_object(
    'allowed', (v->>'remaining')::int >= ai_min_headroom()
  );
end;
$$;

-- Debit the tokens a completed request actually consumed.
-- Called server-side after the model replies. Returns the updated budget.
create or replace function public.record_ai_tokens(p_tokens integer)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_org uuid := current_org();
  v_day date := (now() at time zone 'utc')::date;
begin
  if v_org is null then
    raise exception 'No organization for this user';
  end if;
  if p_tokens is null or p_tokens < 0 then
    raise exception 'Invalid token count';
  end if;

  insert into ai_token_usage (org_id, day, tokens_used, request_count)
  values (v_org, v_day, p_tokens, 1)
  on conflict (org_id, day) do update
    set tokens_used = ai_token_usage.tokens_used + p_tokens,
        request_count = ai_token_usage.request_count + 1,
        updated_at = now();

  return get_ai_budget();
end;
$$;

revoke all on function public.get_ai_budget() from public;
revoke all on function public.check_ai_budget() from public;
revoke all on function public.record_ai_tokens(integer) from public;
grant execute on function public.get_ai_budget() to authenticated;
grant execute on function public.check_ai_budget() to authenticated;
grant execute on function public.record_ai_tokens(integer) to authenticated;

-- The monthly question counter from 0002 is now unused. It is left in place
-- so a deploy in progress cannot break; drop it once the new build is live:
--   drop function if exists public.consume_ai_question();
--   drop function if exists public.get_ai_usage();
