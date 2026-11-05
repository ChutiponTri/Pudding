-- Quiz away tracking, saved live.
-- 1. Each trip away from a quiz (switching apps, losing focus, split screen) is
--    saved on the server while it happens, so closing LINE mid-quiz no longer
--    erases it; the hand-in merges these with the phone's own report.
-- 2. New audit events: split_screen (another app side by side: split screen /
--    Split View on Android and iPad) and pointer_left (desktop pointer out of
--    the quiz window for a while, e.g. on a second monitor). copy_attempt /
--    paste_attempt already existed and are now recorded too.
-- Needs supabase_quiz_exit_update.sql first. Safe to run more than once.

ALTER TABLE public.quiz_attempts ADD COLUMN IF NOT EXISTS away_events JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.submission_events DROP CONSTRAINT IF EXISTS submission_events_event_type_check;
ALTER TABLE public.submission_events ADD CONSTRAINT submission_events_event_type_check
  CHECK (event_type IN ('tab_hidden', 'window_blur', 'split_screen', 'pointer_left', 'tab_visible', 'window_focus', 'copy_attempt', 'paste_attempt', 'quiz_reopened'));
