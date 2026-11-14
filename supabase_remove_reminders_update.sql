-- ==============================================================================
-- Remove automatic deadline reminders
-- The LINE bot no longer sends reminders before a deadline; teachers remind
-- with "ทวงงาน" (the picture the bot answers with the reminder card and
-- @mentions). These columns on `assignments` held the old reminder settings
-- and state and are no longer read or written by the app:
--
--   reminder_cron             old cron-style schedule ('relative_due_date')
--   reminder_offset_minutes   earliest reminder, minutes before the deadline
--   reminder_offsets_minutes  every selected reminder
--   line_last_reminded_at     when the last reminder went out
--   line_reminder_unsent      a reminder the bot could not send (+ its index)
--
-- ORDER MATTERS: deploy the app version without reminders FIRST, then run
-- this. An older deployment still writes these columns when work is saved and
-- would fail with "column does not exist".
--
-- The scheduler stays as the daily job (supabase_daily_cron.sql): daily
-- summary + expired draft cleanup.
--
-- Run this in your Supabase SQL Editor. Safe to re-run. Without CASCADE: if a
-- view of your own uses one of these columns, Postgres stops and names it
-- instead of silently dropping the view.
-- ==============================================================================

DROP INDEX IF EXISTS public.assignments_line_reminder_unsent_idx;

ALTER TABLE public.assignments
  DROP COLUMN IF EXISTS line_reminder_unsent,
  DROP COLUMN IF EXISTS line_last_reminded_at,
  DROP COLUMN IF EXISTS reminder_offsets_minutes,
  DROP COLUMN IF EXISTS reminder_offset_minutes,
  DROP COLUMN IF EXISTS reminder_cron;

-- Make PostgREST forget the dropped columns right away.
NOTIFY pgrst, 'reload schema';

-- Check (should return no rows):
--   SELECT column_name FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'assignments'
--     AND column_name IN ('reminder_cron', 'reminder_offset_minutes', 'reminder_offsets_minutes', 'line_last_reminded_at', 'line_reminder_unsent');
