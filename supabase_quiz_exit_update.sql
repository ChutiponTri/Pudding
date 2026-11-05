-- Quiz exits: closing the LINE quiz screen (X button) and opening it again
-- started a clean answer sheet, so leaving the screen went unrecorded. Every
-- opening of a quiz is now counted on the server; each reopen before handing
-- in is an exit, warned about and then answered with a blank hand-in (0).
-- Safe to run more than once.

CREATE TABLE IF NOT EXISTS public.quiz_attempts (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES public.assignments(id) ON DELETE CASCADE,
  -- users.id of the student the quiz belongs to (the classmate, on a borrowed phone).
  student_id TEXT NOT NULL,
  open_count INTEGER NOT NULL DEFAULT 0,
  -- ISO time of every opening, oldest first.
  opened_at JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (assignment_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_assignment ON public.quiz_attempts(assignment_id);
ALTER TABLE public.quiz_attempts ENABLE ROW LEVEL SECURITY;

-- On the submission: how many times the student left the quiz and came back,
-- and whether the system handed in a blank sheet because of it.
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS quiz_exit_count INTEGER DEFAULT 0;
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS auto_forfeited BOOLEAN DEFAULT FALSE;

-- New audit event: the quiz was closed and opened again.
ALTER TABLE public.submission_events DROP CONSTRAINT IF EXISTS submission_events_event_type_check;
ALTER TABLE public.submission_events ADD CONSTRAINT submission_events_event_type_check
  CHECK (event_type IN ('tab_hidden', 'window_blur', 'tab_visible', 'window_focus', 'copy_attempt', 'paste_attempt', 'quiz_reopened'));
