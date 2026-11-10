-- แบบสอบถาม (survey): a work type with no scores, plus two survey-only question types.
-- Run once in the Supabase SQL editor.

ALTER TABLE public.assignments ADD COLUMN IF NOT EXISTS is_survey BOOLEAN NOT NULL DEFAULT FALSE;

-- checkboxes = several picks (stored as a JSON array of the picked options), scale = 1–5.
ALTER TABLE public.questions DROP CONSTRAINT IF EXISTS questions_type_check;
ALTER TABLE public.questions ADD CONSTRAINT questions_type_check
  CHECK (type IN ('multiple_choice', 'short_answer', 'file_upload', 'true_false', 'checkboxes', 'scale'));
