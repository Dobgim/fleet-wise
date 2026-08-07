-- Security fixes: two live access-control holes found in the audit.
--
--   CRITICAL 1 — set_plan_simulated() let any authenticated user set their own
--   org to any paid plan for free, bypassing Whop entirely. It is a leftover
--   from the simulated-billing era and no application code calls it.
--
--   CRITICAL 2 — the membership insert policy allowed inserting a membership
--   into ANY org as long as user_id was the caller, so a user could join
--   another garage and read or alter its data. Signup relied on that same
--   self-insert path, so it is replaced with a SECURITY DEFINER bootstrap
--   that creates an org and its owner membership atomically for the caller,
--   and nothing else.

-- ---- CRITICAL 1: remove the free-upgrade backdoor -----------------------
drop function if exists public.set_plan_simulated(text);

-- ---- CRITICAL 2: atomic, self-only workspace bootstrap ------------------
--
-- SECURITY DEFINER so it can write the first owner membership, which no RLS
-- policy can allow: is_org_owner() is false until that very row exists, a
-- chicken-and-egg the definer breaks. It only ever acts for the caller
-- (clerk_user_id()), and is idempotent — a user who already has an org gets
-- it back rather than a second one.
create or replace function public.bootstrap_org(p_name text)
returns uuid
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_user text := clerk_user_id();
  v_org uuid;
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  -- Already a member of something: return it, never create a second org.
  select m.org_id into v_org
    from memberships m where m.user_id = v_user limit 1;
  if v_org is not null then
    return v_org;
  end if;

  insert into organizations (name)
  values (coalesce(nullif(btrim(p_name), ''), 'My garage'))
  returning id into v_org;

  insert into memberships (org_id, user_id, role)
  values (v_org, v_user, 'owner');

  return v_org;
end;
$$;

revoke all on function public.bootstrap_org(text) from public;
grant execute on function public.bootstrap_org(text) to authenticated;

-- The client no longer inserts organizations directly; bootstrap_org is the
-- only creation path, so an authenticated user cannot spray orphan orgs.
revoke insert on public.organizations from authenticated;

-- Tighten the membership insert policy: only an existing owner may add a
-- member to their own org. The self-insert clause that made CRITICAL 2
-- possible is gone; the first owner membership is written by bootstrap_org
-- above, which bypasses RLS as definer.
drop policy if exists membership_insert on public.memberships;
create policy membership_insert on public.memberships
  for insert to authenticated
  with check (is_org_owner(org_id));
