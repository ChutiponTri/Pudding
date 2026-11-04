-- Retake quizzes: a quiz only some students may take (e.g. after a suspected
-- cheat), linked to the original quiz. Their retake score replaces the
-- original score, so grade books and exports keep one column per quiz.
-- Safe to run more than once.

ALTER TABLE public.assignments ADD COLUMN IF NOT EXISTS retake_of TEXT REFERENCES public.assignments(id) ON DELETE SET NULL;
-- Roster ids (classroom.students[].id) allowed to see and take the retake. NULL = an ordinary assignment.
ALTER TABLE public.assignments ADD COLUMN IF NOT EXISTS retake_student_ids TEXT[];
CREATE INDEX IF NOT EXISTS idx_assignments_retake_of ON public.assignments(retake_of);

-- On the ORIGINAL quiz's submission: the retake submission whose score replaced it,
-- and the values before that (restored if the retake is deleted).
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS retake_submission_id TEXT;
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS retake_previous JSONB;
