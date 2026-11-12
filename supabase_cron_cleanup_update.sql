-- ==============================================================================
-- Keeps pg_cron's run history small. Every run of 'pudding-line-reminders'
-- (every 5 minutes = 288 a day) adds a row to cron.job_run_details, which is
-- never cleared on its own and slowly fills the database. This daily job keeps
-- the last 7 days (enough to check that reminders ran: see
-- supabase_reminder_cron.sql).
-- Run this in your Supabase SQL Editor. Safe to re-run.
-- ==============================================================================

SELECT cron.unschedule('pudding-cron-history-cleanup')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pudding-cron-history-cleanup');

SELECT cron.schedule(
  'pudding-cron-history-cleanup',
  '17 3 * * *', -- 03:17 UTC daily
  $$ DELETE FROM cron.job_run_details WHERE end_time < NOW() - INTERVAL '7 days' $$
);

-- One-off: clear what has piled up so far.
DELETE FROM cron.job_run_details WHERE end_time < NOW() - INTERVAL '7 days';
