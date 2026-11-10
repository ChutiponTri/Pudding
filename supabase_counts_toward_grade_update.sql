-- Work that does not count toward the grade ("ไม่นับคะแนน"): students still see
-- their score and feedback, and the Excel grade book still shows the score,
-- but it is left out of the total, the full score and the percentage.
-- Safe to run more than once.

ALTER TABLE public.assignments ADD COLUMN IF NOT EXISTS counts_toward_grade BOOLEAN NOT NULL DEFAULT TRUE;
