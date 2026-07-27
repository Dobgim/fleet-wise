-- Move identity from Supabase Auth to Clerk.
--
-- Supabase Auth is no longer the identity provider; Clerk is. Supabase keeps
-- the data and keeps enforcing who may touch it, but it now trusts a Clerk
-- session token instead of issuing its own.
--
-- The one change that ripples through everything: Clerk user IDs are text
-- ("user_2abc..."), not UUIDs. auth.uid() casts the token's `sub` claim to
-- uuid, so it returns null under Clerk and every policy built on it would
-- silently deny — or worse, if written loosely, allow. So every identity
-- check below is rebuilt on auth.jwt() ->> 'sub'.
--
-- DESTRUCTIVE: this wipes all tenant data. That is deliberate and agreed —
-- the old rows are keyed by Supabase user UUIDs that no longer refer to
-- anyone, and pre-launch it is safer to start clean than to remap identities.

-- ------------------------------------------------------------------ wipe
truncate table
  public.service_records,
  public.vehicles,
  public.ai_summaries,
  public.ai_usage,
  public.subscriptions,
  public.memberships,
  public.organizations
cascade;

do $$
begin
  if to_regclass('public.ai_token_usage') is not null then
    execute 'truncate table public.ai_token_usage cascade';
  end if;
  if to_regclass('public.reminder_log') is not null then
    execute 'truncate table public.reminder_log cascade';
  end if;
  if to_regclass('public.reminder_item_log') is not null then
    execute 'truncate table public.reminder_item_log cascade';
  end if;
end $$;

-- --------------------------------------------------------------- identity

-- The Clerk user ID of the caller, straight from the verified session token.
create or replace function public.clerk_user_id()
returns text
language sql stable
as $$
  select nullif(auth.jwt() ->> 'sub', '');
$$;

-- memberships.user_id must hold a Clerk ID now, and can no longer point at
-- auth.users — that table is not the source of users any more.
--
-- The policies that reference this column have to go first: Postgres refuses
-- to alter the type of a column named in a policy expression. They are
-- recreated further down against clerk_user_id().
drop policy if exists membership_select on public.memberships;
drop policy if exists membership_insert on public.memberships;
drop policy if exists membership_update on public.memberships;
drop policy if exists membership_delete on public.memberships;
drop policy if exists require_mfa on public.memberships;

alter table public.memberships
  drop constraint if exists memberships_user_id_fkey;
alter table public.memberships
  alter column user_id type text using user_id::text;

-- Everything the app needs to know about a user, synced from Clerk by
-- /api/clerk/webhook. Without this, the reminder cron and the Paddle webhook
-- would have to call Clerk's API once per user just to learn an address.
create table if not exists public.profiles (
  user_id text primary key,
  email text,
  full_name text,
  -- Mirrors Clerk's two_factor_enabled. The 2FA policy below needs to know
  -- whether a user has 2FA turned on, and Postgres cannot ask Clerk.
  mfa_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated using (user_id = clerk_user_id());
-- Writes happen through the service role in the Clerk webhook only: a user
-- must not be able to flip their own mfa_enabled flag to false and thereby
-- switch off the restrictive policy below.

-- ------------------------------------------------- membership predicates

create or replace function public.is_org_member(org uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from memberships m
    where m.org_id = org and m.user_id = clerk_user_id()
  );
$$;

create or replace function public.is_org_owner(org uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from memberships m
    where m.org_id = org and m.user_id = clerk_user_id() and m.role = 'owner'
  );
$$;

create or replace function public.current_org()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select m.org_id from memberships m where m.user_id = clerk_user_id() limit 1;
$$;

-- Recreated now that the column is text and the helpers read Clerk's `sub`.
-- membership_update is intentionally not restored: role changes belong to the
-- owner path, and nothing in the app updates a membership row.
create policy membership_select on public.memberships
  for select to authenticated
  using (user_id = clerk_user_id() or is_org_member(org_id));
create policy membership_insert on public.memberships
  for insert to authenticated
  with check (user_id = clerk_user_id() or is_org_owner(org_id));
create policy membership_delete on public.memberships
  for delete to authenticated
  using (is_org_owner(org_id) or user_id = clerk_user_id());

-- ------------------------------------------------------------------- 2FA

-- Same promise as before, kept through the provider change: 2FA is optional,
-- but once a user turns it on, a session that has not cleared it cannot read
-- or write their data — not through the app, and not by pointing a stolen
-- token at the REST API.
--
-- Clerk puts an `fva` claim in the token: [firstFactorAge, secondFactorAge]
-- in minutes. A secondFactorAge of -1 means "no second factor was verified".
-- Any other value means one was.
create or replace function public.mfa_satisfied()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select case
    when coalesce(
           (select p.mfa_enabled from profiles p where p.user_id = clerk_user_id()),
           false)
    then coalesce(auth.jwt() -> 'fva' ->> 1, '-1') <> '-1'
    else true
  end;
$$;

revoke all on function public.mfa_satisfied() from public;
revoke all on function public.clerk_user_id() from public;
grant execute on function public.mfa_satisfied() to authenticated;
grant execute on function public.clerk_user_id() to authenticated;

-- Re-assert the restrictive policies from 0010 so they pick up the new
-- mfa_satisfied(), and cover profiles too.
do $$
declare t text;
begin
  foreach t in array array[
    'organizations', 'memberships', 'vehicles', 'service_records',
    'subscriptions', 'ai_summaries', 'ai_usage', 'reminder_log',
    'ai_token_usage', 'reminder_item_log', 'profiles'
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

-- ------------------------------------------------------------- dead code

-- The monthly question counter was replaced by daily token budgets in 0005
-- and is the last thing still reading auth.uid(). Under Clerk it would
-- return null and quietly meter the wrong org, so remove it for good.
drop function if exists public.consume_ai_question();
drop function if exists public.get_ai_usage();
drop function if exists public.ai_question_limit(text);
