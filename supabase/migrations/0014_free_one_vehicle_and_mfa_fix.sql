-- Two fixes. Safe to run more than once, and safe to run out of order —
-- this migration is written to be the final authority on both functions.

-- ============================================================ 1 · THE BUG
--
-- mfa_satisfied() was still the Supabase Auth version from 0010, which calls
-- auth.uid(). auth.uid() casts the token's `sub` claim to uuid, and a Clerk
-- ID is text ("user_2abc..."), so it raised:
--
--   invalid input syntax for type uuid: "user_3H5dh..."
--
-- That function backs the RESTRICTIVE require_mfa policy on every table, so
-- the failure was total: reads and writes on memberships and profiles both
-- threw. The visible symptom was a user who could sign in but had no
-- organization — the membership insert never landed — and therefore an app
-- that reported "checkout isn't available".
--
-- How it happened: 0011 replaced this function, but re-running 0010
-- afterwards put the old body back. Same name, same signature, so
-- CREATE OR REPLACE silently reinstated the broken version.
--
-- Under Clerk there is no auth.mfa_factors table to consult: whether a user
-- has 2FA on is mirrored into public.profiles by the Clerk webhook, and
-- whether they *used* it this session is in the token's `fva` claim.
create or replace function public.mfa_satisfied()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when coalesce(
           (select p.mfa_enabled from profiles p
             where p.user_id = nullif(auth.jwt() ->> 'sub', '')),
           false)
    -- fva = [firstFactorAge, secondFactorAge] in minutes; -1 means no second
    -- factor was verified.
    then coalesce(auth.jwt() -> 'fva' ->> 1, '-1') <> '-1'
    else true
  end;
$$;

revoke all on function public.mfa_satisfied() from public;
grant execute on function public.mfa_satisfied() to authenticated;

-- Guard against the same mistake again: if 0010 is ever replayed, this
-- comment is the tell that the wrong version is in place.
comment on function public.mfa_satisfied() is
  'Clerk-aware. Never restore the 0010 (auth.uid) version - it breaks every policy.';

-- =================================================== 2 · FREE = 1 VEHICLE
--
-- The free plan covers a single vehicle. Everything past the first is billed
-- at the per-vehicle rate, so a five-vehicle fleet pays for four.
create or replace function public.free_vehicles()
returns integer language sql immutable as $$ select 1; $$;

revoke all on function public.free_vehicles() from public;
grant execute on function public.free_vehicles() to authenticated;

-- ------------------------------------------------------------- integrity
--
-- An organization with no owner membership is unreachable: nobody can read
-- it, and the app will create a second one on the next sign-in. That is
-- exactly the state the bug above left behind. Clear any such rows so the
-- bootstrap starts clean. Orgs with members are untouched.
delete from public.organizations o
where not exists (
  select 1 from public.memberships m where m.org_id = o.id
);
