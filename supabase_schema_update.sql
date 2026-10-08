-- ==============================================================================
-- PUDDING PLATFORM: SUPABASE DATABASE MIGRATION SCRIPT
-- Run this script in your Supabase SQL Editor (https://app.supabase.com)
-- ==============================================================================

-- 1. Ensure `institution` column exists on `users` table
ALTER TABLE IF EXISTS public.users
ADD COLUMN IF NOT EXISTS institution TEXT,
ADD COLUMN IF NOT EXISTS enrollment_status TEXT DEFAULT 'active';

-- 2. Ensure `pending_students` column exists on `classrooms` table
ALTER TABLE IF EXISTS public.classrooms
ADD COLUMN IF NOT EXISTS pending_students JSONB DEFAULT '[]'::jsonb;

-- 3. Ensure `status` column exists on `classroom_students` table ('active' | 'pending_approval')
ALTER TABLE IF EXISTS public.classroom_students
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';

-- 4. Ensure `research_grades` column exists on `submission_answers` for IRR / Research Co-evaluators
ALTER TABLE IF EXISTS public.submission_answers
ADD COLUMN IF NOT EXISTS research_grades JSONB DEFAULT '{}'::jsonb;

-- 5. Create index for fast lookups by institution and student_id
CREATE INDEX IF NOT EXISTS idx_users_institution ON public.users(institution);
CREATE INDEX IF NOT EXISTS idx_users_student_id ON public.users(student_id);
CREATE INDEX IF NOT EXISTS idx_classroom_students_status ON public.classroom_students(status);

-- 6. Enable Full Replica Identity for Realtime tracking on classrooms & classroom_students
ALTER TABLE IF EXISTS public.classrooms REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS public.classroom_students REPLICA IDENTITY FULL;

-- 7. Add tables to Supabase Realtime publication
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.classrooms;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.classroom_students;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;
END $$;

-- 8. Verify schema state
SELECT
  column_name,
  data_type
FROM information_schema.columns
WHERE table_name IN ('users', 'classrooms', 'classroom_students', 'submission_answers')
  AND column_name IN ('institution', 'pending_students', 'status', 'research_grades')
ORDER BY table_name, column_name;
