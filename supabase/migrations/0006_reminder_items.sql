-- Exactly-once, one-week-ahead reminders.
--
-- The first version of the daily job deduped per DAY, so a garage with an
-- overdue service was emailed every single morning until it was fixed.
-- This log dedupes per PREDICTED SERVICE instead: each (vehicle, service
-- type, due date) gets at most one "due in a week" email and at most one
-- "now overdue" email, ever. A new service record moves the due date, which
-- naturally arms the next reminder.

create table if not exists public.reminder_item_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  vehicle_id uuid not null references public.vehicles (id) on delete cascade,
  service_type text not null,
  due_date date not null,
  stage text not null check (stage in ('upcoming', 'overdue')),
  recipient text not null,
  sent_at timestamptz not null default now(),
  unique (vehicle_id, service_type, due_date, stage)
);

create index if not exists reminder_item_log_org_idx
  on public.reminder_item_log (org_id);

alter table public.reminder_item_log enable row level security;

-- Members may read their own send history; only the service role writes.
create policy reminder_item_log_select on public.reminder_item_log
  for select to authenticated using (is_org_member(org_id));

-- The per-day reminder_log from 0004 is superseded by this table and no
-- longer written. Drop it once comfortable:
--   drop table if exists public.reminder_log;
