-- Email maintenance reminders.
--
-- A daily job reads every garage's fleet, works out what is overdue or due
-- soon, and emails the owner. Two things are needed in the database: a way
-- for users to switch the emails off, and a record of what was already sent
-- so a retried or double-triggered job cannot spam anyone.

alter table public.organizations
  add column if not exists reminders_enabled boolean not null default true;

-- Users may rename their garage and toggle reminders — nothing else.
-- (0003 revoked blanket UPDATE and granted only `name`.)
grant update (name, reminders_enabled) on public.organizations to authenticated;

create table if not exists public.reminder_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  sent_on date not null,
  item_count integer not null default 0,
  recipient text not null,
  created_at timestamptz not null default now(),
  unique (org_id, sent_on)
);

create index if not exists reminder_log_org_idx on public.reminder_log (org_id);

alter table public.reminder_log enable row level security;

-- Members may see their own send history; only the service role writes here.
create policy reminder_log_select on public.reminder_log
  for select to authenticated using (is_org_member(org_id));
