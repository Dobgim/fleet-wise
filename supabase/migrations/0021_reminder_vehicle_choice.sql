-- Let a customer choose which vehicles get reminders.
--
-- The problem this solves is the downgrade. Someone on Premium with ten
-- vehicles who stops paying keeps all ten records — deleting a customer's
-- data because they stopped paying would be indefensible — but Free only
-- covers two. Something has to decide which two still get emailed, and the
-- only party entitled to decide is the customer.
--
-- Existing vehicles default to enabled so nothing goes quiet for anyone
-- already using the product.

alter table public.vehicles
  add column if not exists reminders_enabled boolean not null default true;

comment on column public.vehicles.reminders_enabled is
  'Whether this vehicle is one the owner wants maintenance reminders for. Capped by the plan via reminder_vehicle_ids().';

/*
 * The vehicles an org may actually be emailed about.
 *
 * Two rules, in order: the owner's choice, then the plan's cap. The cap has
 * to be applied here rather than trusted from the column, because a
 * downgrade changes the limit without touching any vehicle row — ten
 * vehicles all marked enabled is the normal state immediately after a
 * subscription lapses.
 *
 * Ordering by created_at makes the fallback predictable: until the owner
 * chooses, the oldest vehicles are the ones that keep working, which are the
 * ones they have had reminders for all along.
 */
create or replace function public.reminder_vehicle_ids(org uuid)
returns setof uuid
language sql stable security definer
set search_path = public
as $$
  select v.id
  from vehicles v
  where v.org_id = org
    and v.reminders_enabled
  order by v.created_at
  limit coalesce(public.vehicle_limit_for_org(org), 2147483647);
$$;

revoke all on function public.reminder_vehicle_ids(uuid) from public;
grant execute on function public.reminder_vehicle_ids(uuid) to authenticated, service_role;

/*
 * Refuse to enable more vehicles than the plan covers.
 *
 * Only fires when reminders are being switched ON, so a downgrade never
 * blocks an unrelated edit to a vehicle that is already over the cap — the
 * customer must still be able to correct their mileage while deciding which
 * two to keep.
 */
create or replace function public.enforce_reminder_limit()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  lim integer := public.vehicle_limit_for_org(new.org_id);
  enabled integer;
begin
  if not new.reminders_enabled or coalesce(old.reminders_enabled, false) then
    return new;                      -- turning off, or already on: nothing to check
  end if;

  select count(*) into enabled
    from vehicles
   where org_id = new.org_id and reminders_enabled and id <> new.id;

  if lim is not null and enabled >= lim then
    raise exception 'reminder_limit_reached (allowed %, enabled %)', lim, enabled
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists vehicles_enforce_reminder_limit on public.vehicles;
create trigger vehicles_enforce_reminder_limit
  before update of reminders_enabled on public.vehicles
  for each row execute function public.enforce_reminder_limit();
