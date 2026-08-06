-- Welcome email: one per user, ever.
--
-- Clerk retries a webhook until it gets a 2xx, and it re-sends user.created
-- on its own schedule after a network blip. Without a claim marker, a new
-- customer's very first impression of MotorWise would be the same email
-- arriving three times.
--
-- The claim is an UPDATE ... WHERE welcome_email_sent_at IS NULL, which is
-- atomic in Postgres: two concurrent deliveries race, exactly one updates a
-- row, and only that one sends. Same pattern as reminder_item_log.

alter table public.profiles
  add column if not exists welcome_email_sent_at timestamptz;

comment on column public.profiles.welcome_email_sent_at is
  'Set when the welcome email was claimed for sending. NULL means never sent. Written only by the Clerk webhook (service role).';

-- Existing users predate the welcome email. Mark them as already sent so
-- turning this on does not mail everyone who ever signed up.
update public.profiles
   set welcome_email_sent_at = now()
 where welcome_email_sent_at is null;
