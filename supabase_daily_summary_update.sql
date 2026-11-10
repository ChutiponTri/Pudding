-- ==========================================
-- สรุปประจำวัน (daily summary in the teacher's 1:1 LINE chat)
-- ==========================================
-- line_daily_summary:    the teacher's choice ("ปิดสรุป" / "เปิดสรุป" in the
--                        1:1 chat); on by default.
-- line_daily_summary_on: the school day (Asia/Bangkok) this teacher was last
--                        handled, so the five-minute scheduler sends once a day.
-- Deploy the code first or after: without these columns the scheduler skips the summary.
-- Run once in the Supabase SQL editor.

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS line_daily_summary BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS line_daily_summary_on DATE;
