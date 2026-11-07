-- Quiz duration: a quiz is given as "N minutes after it is published" instead
-- of a fixed due date. due_date is still stored (publish time + N minutes);
-- this column lets a draft or scheduled quiz that is published early keep its
-- N minutes from the actual publish time.
-- Safe to run more than once.

ALTER TABLE public.assignments ADD COLUMN IF NOT EXISTS quiz_duration_minutes INTEGER
  CHECK (quiz_duration_minutes IS NULL OR quiz_duration_minutes > 0);
