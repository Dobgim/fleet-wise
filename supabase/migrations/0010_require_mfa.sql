-- Two-factor authentication, enforced in the database.
--
-- Hiding pages in the app is not security: a stolen password gives an
-- attacker a valid token they can point straight at the REST API, skipping
-- our UI entirely. So the rule lives here, next to the data.
--
-- The rule: if a user has enrolled an authenticator app, every request they
-- make must carry aal2 (password AND a fresh 6-digit code). Users who have
-- not enrolled are unaffected — 2FA stays optional, but once you turn it on
-- it cannot be sidestepped.

-- auth.mfa_factors is not readable by the authenticated role, so this reads
-- it as definer. It returns only a boolean about the caller's own account.
create or replace function public.mfa_satisfied()
returns boolean
language sql
stable
security definer
set search_path = auth, public
as $$
  select case
    when exists (
      select 1 from auth.mfa_factors f
      where f.user_id = auth.uid() and f.status = 'verified'
    )
    then coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
    else true
  end;
$$;

revoke all on function public.mfa_satisfied() from public;
grant execute on function public.mfa_satisfied() to authenticated;

-- RESTRICTIVE policies are ANDed with the existing permissive ones, so this
-- adds a requirement to every table without rewriting a single policy above.
-- The service role bypasses RLS, so the cron job and the Paddle webhook keep
-- working regardless.
do $$
declare t text;
begin
  foreach t in array array[
    'organizations', 'memberships', 'vehicles', 'service_records',
    'subscriptions', 'ai_summaries', 'ai_usage', 'reminder_log',
    'ai_token_usage', 'reminder_item_log'
  ]
  loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists require_mfa on public.%I', t);
      execute format(
        'create policy require_mfa on public.%I as restrictive to authenticated
           using (public.mfa_satisfied()) with check (public.mfa_satisfied())', t);
    end if;
  end loop;
end $$;

-- The token functions are SECURITY DEFINER, so they bypass the policies
-- above. Spending money is exactly what a stolen password would be used for,
-- so gate them explicitly. (get_ai_budget is left open: reading your own
-- remaining allowance leaks nothing and the app reads it during start-up.)
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

create or replace function public.record_ai_tokens(p_tokens integer)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_org uuid := current_org();
  v_day date := (now() at time zone 'utc')::date;
begin
  if not public.mfa_satisfied() then
    raise exception 'Two-factor authentication required' using errcode = '42501';
  end if;
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
