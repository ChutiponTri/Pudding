-- ==========================================
-- Pudding scheduler (path kept as /api/line/reminders)
-- ==========================================
-- Every five minutes: deletes drafts never published and, from 17:00, sends
-- each teacher's daily summary once. (Scheduled publishing and automatic
-- deadline reminders were removed; teachers use "ทวงงาน".) Runs from Supabase
-- (pg_cron + pg_net, both available on the free plan), so it does not depend
-- on Vercel Cron limits.
--
-- Before running, replace:
--   (the URL below is the production site; change it if the domain changes)
--   <CRON_SECRET>  the value of LINE_REMINDER_CRON_SECRET in Vercel env vars
--
-- Run in the Supabase SQL editor. Re-running replaces the job.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule('pudding-line-reminders')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pudding-line-reminders');

SELECT cron.schedule(
  'pudding-line-reminders',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://www.pudding-p.com/api/line/reminders',
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
