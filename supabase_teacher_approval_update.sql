-- ==========================================
-- Teacher approval (strict mode) + LINE test-message quota
-- ==========================================
-- ⚠️ Run this BEFORE deploying the app version that checks
-- users.teacher_approval. Without the column every teacher is blocked
-- (the server fails closed when it cannot read the approval).
--
-- teacher_approval: only meaningful for role = 'teacher'.
--   'approved' -> may use the teacher web app
--   'pending'  -> waiting for the admin (NULL means the same)
--   'rejected' -> refused by the admin
-- New teacher rows are created with NULL, so every new sign-up waits for the
-- admin to approve it in /admin/teachers.
--
-- Safe to re-run.

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS teacher_approval TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_teacher_approval_check') THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_teacher_approval_check
      CHECK (teacher_approval IS NULL OR teacher_approval IN ('pending', 'approved', 'rejected'));
  END IF;
END $$;

-- Teachers who were already using Pudding keep working. (To review them too,
-- skip this line, or set some back to 'pending' in /admin/teachers.)
UPDATE public.users SET teacher_approval = 'approved' WHERE role IN ('teacher', 'admin') AND teacher_approval IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_teacher_approval ON public.users(teacher_approval) WHERE role = 'teacher';
