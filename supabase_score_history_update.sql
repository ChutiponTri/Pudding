-- Score history of a grade-book cell: every สอบซ่อม (retake) and สอบใหม่
-- (ให้สอบใหม่, the quiz sheet reset) that replaced a student's score, with the
-- score it replaced. Shown as a mark in the grade book and as a cell comment
-- in the Excel export. Kept on the row whose score the grade book shows (the
-- original quiz for a retake). Safe to run more than once.

ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS score_history JSONB;
