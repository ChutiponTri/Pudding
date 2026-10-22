-- ==============================================================================
-- Supabase Schema & Permissions Update for Classroom Timeline, Groups & Attendance
-- Run this in your Supabase SQL Editor if you want to sync all tables in Postgres
-- ==============================================================================

-- 1. Ensure classroom_posts table exists and has proper permissions
CREATE TABLE IF NOT EXISTS public.classroom_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  classroom_id UUID NOT NULL REFERENCES public.classrooms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  title TEXT,
  body TEXT NOT NULL,
  attachments JSONB DEFAULT '[]'::jsonb,
  activity_type TEXT DEFAULT 'announcement', -- 'announcement' | 'assignment' | 'exam' | 'attendance'
  activity_ref_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Server-only table: the app reaches it with the service_role key (RLS on, no public policies).
GRANT ALL ON TABLE public.classroom_posts TO service_role;
ALTER TABLE public.classroom_posts ENABLE ROW LEVEL SECURITY;

-- 2. Add group_name column to assignments if not present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'assignments'
      AND column_name = 'group_name'
  ) THEN
    ALTER TABLE public.assignments ADD COLUMN group_name TEXT DEFAULT 'ทั่วไป';
  END IF;
END $$;

-- 3. Ensure attendance tables exist with proper permissions
CREATE TABLE IF NOT EXISTS public.attendance_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  classroom_id UUID NOT NULL REFERENCES public.classrooms(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  starts_at TIMESTAMPTZ DEFAULT NOW(),
  ends_at TIMESTAMPTZ,
  status TEXT DEFAULT 'open', -- 'open' | 'closed'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.attendance_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.attendance_sessions(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL,
  student_name TEXT,
  status TEXT NOT NULL, -- 'on_time' | 'late' | 'excused' | 'absent'
  check_in_time TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Server-only tables: the app reaches them with the service_role key (RLS on, no public policies).
GRANT ALL ON TABLE public.attendance_sessions TO service_role;
GRANT ALL ON TABLE public.attendance_records TO service_role;
ALTER TABLE public.attendance_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;
