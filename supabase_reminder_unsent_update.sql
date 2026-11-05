-- ==========================================
-- Deadline reminders the LINE bot could not send
-- ==========================================
-- The reminder cron (/api/line/reminders) checks the LINE monthly quota before
-- pushing. When the bot cannot send a reminder (quota too low for the group,
-- no linked group, or LINE refusing it 3 times) it records why here, and the
-- teacher's web pages offer to share the reminder from their own LINE.
--   { "reason": "quota" | "failed" | "no_group" | "retry", "at": "<iso>", "attempts": n }
-- Cleared when the reminder is sent, shared by hand, or dismissed.
--
-- Without this column reminders still work; a failed one is just skipped
-- (no retry storm) and the teacher is not told.
--
-- Run in the Supabase SQL editor. Safe to run again.

ALTER TABLE assignments ADD COLUMN IF NOT EXISTS line_reminder_unsent jsonb;

CREATE INDEX IF NOT EXISTS assignments_line_reminder_unsent_idx
  ON assignments (classroom_id)
  WHERE line_reminder_unsent IS NOT NULL;
