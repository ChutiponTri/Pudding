-- ==============================================================================
-- "ปิดรับส่งงาน": when homework stops accepting late work
-- After the due date, homework is still accepted (marked late) until close_at,
-- then closes by itself. Optional: NULL keeps the default, 24 hours after the
-- due date (or after an extended deadline). Quizzes ignore it: they close at
-- their deadline.
-- Without this column the app still works (every work uses the 24-hour default;
-- a chosen close time is not saved).
-- Run this in your Supabase SQL Editor. Safe to re-run.
-- ==============================================================================

ALTER TABLE public.assignments ADD COLUMN IF NOT EXISTS close_at TIMESTAMPTZ;

NOTIFY pgrst, 'reload schema';
