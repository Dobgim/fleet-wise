-- Server-side AI quota metering.
--
-- The monthly question counter used to live in the browser, where a user
-- could edit it (or their plan) and spend the operator's OpenAI credit
-- without limit. These functions move both the counter and the limit check
-- into Postgres: they run as SECURITY DEFINER, derive the caller's org from
-- auth.uid(), and are the only writable path into ai_usage.

-- Monthly question allowance per plan. Keep in sync with src/lib/plans.ts.
-- NULL = unlimited.
create or replace function public.ai_question_limit(p_plan text)
returns integer
language sql immutable
as $$
  select case p_plan
    when 'free' then 10
    when 'pro' then 200
    else null            -- business: unlimited
  end;
$$;

-- The caller's organization (first membership; users belong to exactly one
-- org today).
create or replace function public.current_org()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select m.org_id from memberships m where m.user_id = auth.uid() limit 1;
$$;

-- Read-only view of this month's usage for the caller's org.
-- Returns: { "count": int, "limit": int|null, "remaining": int|null }
create or replace function public.get_ai_usage()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_org uuid := current_org();
  v_month text := to_char(now(), 'YYYY-MM');
  v_plan text;
  v_limit integer;
  v_count integer;
begin
  if v_org is null then
    return jsonb_build_object('count', 0, 'limit', 0, 'remaining', 0);
  end if;

  select plan into v_plan from organizations where id = v_org;
  v_limit := ai_question_limit(coalesce(v_plan, 'free'));

  select coalesce(question_count, 0) into v_count
  from ai_usage where org_id = v_org and month = v_month;
  v_count := coalesce(v_count, 0);

  return jsonb_build_object(
    'count', v_count,
    'limit', v_limit,
    'remaining', case when v_limit is null then null
                      else greatest(0, v_limit - v_count) end
  );
end;
$$;

-- Atomically consume one AI question if the plan allows it.
-- Returns: { "allowed": bool, "count": int, "limit": int|null,
--            "remaining": int|null }
-- The increment and the limit check happen in one statement, so parallel
-- requests cannot race past the quota.
create or replace function public.consume_ai_question()
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_org uuid := current_org();
  v_month text := to_char(now(), 'YYYY-MM');
  v_plan text;
  v_limit integer;
  v_count integer;
begin
  if v_org is null then
    return jsonb_build_object('allowed', false, 'count', 0,
                              'limit', 0, 'remaining', 0);
  end if;

  select plan into v_plan from organizations where id = v_org;
  v_limit := ai_question_limit(coalesce(v_plan, 'free'));

  insert into ai_usage (org_id, month, question_count)
  values (v_org, v_month, 1)
  on conflict (org_id, month) do update
    set question_count = ai_usage.question_count + 1
    where v_limit is null or ai_usage.question_count < v_limit
  returning question_count into v_count;

  if v_count is null then
    -- Conflict target existed but the WHERE blocked the update: quota spent.
    select question_count into v_count
    from ai_usage where org_id = v_org and month = v_month;
    return jsonb_build_object('allowed', false, 'count', v_count,
                              'limit', v_limit, 'remaining', 0);
  end if;

  return jsonb_build_object(
    'allowed', true, 'count', v_count, 'limit', v_limit,
    'remaining', case when v_limit is null then null
                      else greatest(0, v_limit - v_count) end
  );
end;
$$;

revoke all on function public.consume_ai_question() from public;
revoke all on function public.get_ai_usage() from public;
grant execute on function public.consume_ai_question() to authenticated;
grant execute on function public.get_ai_usage() to authenticated;
