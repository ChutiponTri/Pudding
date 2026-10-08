-- ==============================================================================
-- PUDDING PLATFORM: COMPREHENSIVE SUPABASE DATABASE MIGRATION SCRIPT
-- Run this script in your Supabase SQL Editor (https://app.supabase.com)
-- ==============================================================================

-- 1. Ensure all columns exist on `users` table
ALTER TABLE IF EXISTS public.users
ADD COLUMN IF NOT EXISTS first_name TEXT DEFAULT '',
ADD COLUMN IF NOT EXISTS last_name TEXT DEFAULT '',
ADD COLUMN IF NOT EXISTS student_id TEXT,
ADD COLUMN IF NOT EXISTS institution TEXT,
ADD COLUMN IF NOT EXISTS enrollment_status TEXT DEFAULT 'active',
ADD COLUMN IF NOT EXISTS line_uid TEXT,
ADD COLUMN IF NOT EXISTS clerk_id TEXT,
ADD COLUMN IF NOT EXISTS avatar_url TEXT,
ADD COLUMN IF NOT EXISTS email TEXT,
ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'teacher',
ADD COLUMN IF NOT EXISTS is_line_connected BOOLEAN DEFAULT FALSE;

-- 2. Ensure all columns exist on `classrooms` table
ALTER TABLE IF EXISTS public.classrooms
ADD COLUMN IF NOT EXISTS pending_students JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS teachers JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS semester INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS year_ce INTEGER DEFAULT 2026,
ADD COLUMN IF NOT EXISTS subject_code TEXT,
ADD COLUMN IF NOT EXISTS invite_code TEXT;

-- 3. Ensure all columns exist on `courses` table
ALTER TABLE IF EXISTS public.courses
ADD COLUMN IF NOT EXISTS teachers JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS semester INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS year_ce INTEGER DEFAULT 2026,
ADD COLUMN IF NOT EXISTS indicators JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS classroom_ids JSONB DEFAULT '[]'::jsonb;

-- 4. Ensure `classroom_students` table exists with status & joined_via
CREATE TABLE IF NOT EXISTS public.classroom_students (
  id TEXT PRIMARY KEY,
  classroom_id TEXT NOT NULL REFERENCES public.classrooms(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'active', -- 'active' | 'pending_approval'
  joined_via TEXT DEFAULT 'line_liff',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE IF EXISTS public.classroom_students
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active',
ADD COLUMN IF NOT EXISTS joined_via TEXT DEFAULT 'line_liff';

-- 5. Ensure `submission_answers` has `research_grades` for IRR / Research Co-evaluators
ALTER TABLE IF EXISTS public.submission_answers
ADD COLUMN IF NOT EXISTS research_grades JSONB DEFAULT '{}'::jsonb;

-- 6. Create indexes for high-speed queries
CREATE INDEX IF NOT EXISTS idx_users_institution ON public.users(institution);
CREATE INDEX IF NOT EXISTS idx_users_student_id ON public.users(student_id);
CREATE INDEX IF NOT EXISTS idx_users_line_uid ON public.users(line_uid);
CREATE INDEX IF NOT EXISTS idx_classroom_students_status ON public.classroom_students(status);
CREATE INDEX IF NOT EXISTS idx_classroom_students_classroom_id ON public.classroom_students(classroom_id);

-- 7. Enable Full Replica Identity for Realtime tracking
ALTER TABLE IF EXISTS public.users REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS public.classrooms REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS public.classroom_students REPLICA IDENTITY FULL;

-- 8. Add tables to Supabase Realtime publication
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.users;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;
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

-- 9. Verify schema state
SELECT
  table_name,
  column_name,
  data_type
FROM information_schema.columns
WHERE table_name IN ('users', 'classrooms', 'courses', 'classroom_students', 'submission_answers')
  AND column_name IN ('first_name', 'last_name', 'student_id', 'institution', 'pending_students', 'teachers', 'status', 'research_grades')
ORDER BY table_name, column_name;
