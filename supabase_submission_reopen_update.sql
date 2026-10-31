-- ==============================================================================
-- Editing handed-in homework
-- Students may edit handed-in homework (not quizzes) until the teacher grades it
-- or the work closes. The teacher can also let one student edit again, even
-- after grading or closing; this column records that. NULL = not reopened.
-- It is cleared when the student hands in the edited work.
-- Run this in your Supabase SQL Editor.
-- ==============================================================================

ALTER TABLE public.submissions
ADD COLUMN IF NOT EXISTS reopened_at TIMESTAMPTZ;
