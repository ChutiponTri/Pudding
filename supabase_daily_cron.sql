-- ==========================================
-- Pudding daily job: /api/cron/daily
-- ==========================================
-- Hourly 17:00–21:00 Bangkok (10:00–14:00 UTC; pg_cron runs in UTC): sends
-- each teacher's daily summary once and deletes drafts never published. The
-- first run sends; later runs only pick up teachers an earlier run missed.
-- Runs from Supabase (pg_cron + pg_net, both on the free plan).
--
-- Before running, replace:
--   (the URL below is the production site; change it if the domain changes)
--   <CRON_SECRET>  the value of LINE_REMINDER_CRON_SECRET in Vercel env vars
--
-- Run in the Supabase SQL editor AFTER deploying the app with /api/cron/daily.
-- Re-running replaces the job.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- The old 5-minute job that called /api/line/reminders.
SELECT cron.unschedule('pudding-line-reminders')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pudding-line-reminders');

SELECT cron.unschedule('pudding-daily')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pudding-daily');

SELECT cron.schedule(
  'pudding-daily',
  '0 10-14 * * *',
  $$
  SELECT net.http_post(
    url := 'https://www.pudding-p.com/api/cron/daily',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <CRON_SECRET>'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);

-- Check it is running (status should be 200):
--   SELECT status_code, content, created FROM net._http_response ORDER BY created DESC LIMIT 5;
