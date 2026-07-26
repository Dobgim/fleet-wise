-- Three reminder stages instead of two.
--
-- A single warning a week ahead is easy to miss, so each predicted service
-- now gets up to three emails, each exactly once:
--
--     upcoming_7  — first time it falls within 7 days of the due date
--     upcoming_3  — first time it falls within 3 days
--     overdue     — first time the due date has passed
--
-- The unique index on (vehicle, type, due_date, stage) still guarantees
-- exactly-once per stage, so a service cannot nag daily. Logging the new
-- service moves the due date, which arms a fresh set of three.

alter table public.reminder_item_log
  drop constraint if exists reminder_item_log_stage_check;

-- 'upcoming' is kept so rows written before this migration stay valid.
alter table public.reminder_item_log
  add constraint reminder_item_log_stage_check
  check (stage in ('upcoming_7', 'upcoming_3', 'overdue', 'upcoming'));
