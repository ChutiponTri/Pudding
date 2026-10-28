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
ADD COLUMN IF NOT EXISTS is_line_connected BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS line_link_status TEXT DEFAULT 'disconnected',
ADD COLUMN IF NOT EXISTS line_link_token_hash TEXT,
ADD COLUMN IF NOT EXISTS line_link_token TEXT,
ADD COLUMN IF NOT EXISTS line_link_token_expires_at TIMESTAMPTZ;

-- 2. Ensure all columns exist on `classrooms` table
ALTER TABLE IF EXISTS public.classrooms
ADD COLUMN IF NOT EXISTS pending_students JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS teachers JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS semester INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS year_ce INTEGER DEFAULT 2026,
ADD COLUMN IF NOT EXISTS subject_code TEXT,
ADD COLUMN IF NOT EXISTS invite_code TEXT;

-- LINE group reminder configuration
ALTER TABLE IF EXISTS public.classrooms
ADD COLUMN IF NOT EXISTS line_group_id TEXT,
ADD COLUMN IF NOT EXISTS line_connection_status TEXT DEFAULT 'disconnected',
ADD COLUMN IF NOT EXISTS line_connection_token_hash TEXT,
ADD COLUMN IF NOT EXISTS line_connection_token TEXT,
ADD COLUMN IF NOT EXISTS line_connection_token_expires_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS line_connected_at TIMESTAMPTZ;

-- 3. Ensure all columns exist on `courses` table
ALTER TABLE IF EXISTS public.courses
ADD COLUMN IF NOT EXISTS teachers JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS semester INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS year_ce INTEGER DEFAULT 2026,
ADD COLUMN IF NOT EXISTS indicators JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS classroom_ids JSONB DEFAULT '[]'::jsonb;

ALTER TABLE IF EXISTS public.assignments
ADD COLUMN IF NOT EXISTS reminder_offset_minutes INTEGER DEFAULT 1440,
ADD COLUMN IF NOT EXISTS line_last_reminded_at TIMESTAMPTZ;

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

-- 4.1 Attendance sessions and per-student records
CREATE TABLE IF NOT EXISTS public.attendance_sessions (
  id TEXT PRIMARY KEY,
  classroom_id TEXT NOT NULL REFERENCES public.classrooms(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'เช็กชื่อ',
  starts_at TIMESTAMPTZ NOT NULL,
  on_time_until_minutes INTEGER NOT NULL DEFAULT 10,
  late_until_minutes INTEGER NOT NULL DEFAULT 30,
  status TEXT NOT NULL DEFAULT 'open',
  closed_at TIMESTAMPTZ,
  created_by TEXT NOT NULL REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT attendance_sessions_status_check CHECK (status IN ('scheduled', 'open', 'closed')),
  CONSTRAINT attendance_sessions_time_check CHECK (on_time_until_minutes >= 0 AND late_until_minutes >= on_time_until_minutes)
);

CREATE TABLE IF NOT EXISTS public.attendance_records (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES public.attendance_sessions(id) ON DELETE CASCADE,
  classroom_id TEXT NOT NULL REFERENCES public.classrooms(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'absent',
  checked_at TIMESTAMPTZ,
  adjusted_at TIMESTAMPTZ,
  adjusted_by TEXT REFERENCES public.users(id),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT attendance_records_status_check CHECK (status IN ('on_time', 'late', 'absent', 'excused')),
  UNIQUE (session_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_attendance_sessions_classroom ON public.attendance_sessions(classroom_id, starts_at DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_records_session ON public.attendance_records(session_id);

-- 4.2 Classroom announcements
CREATE TABLE IF NOT EXISTS public.classroom_posts (
  id TEXT PRIMARY KEY,
  classroom_id TEXT NOT NULL REFERENCES public.classrooms(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES public.users(id),
  body TEXT NOT NULL,
  activity_type TEXT NOT NULL DEFAULT 'announcement',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE IF EXISTS public.classroom_posts
  ADD COLUMN IF NOT EXISTS activity_type TEXT NOT NULL DEFAULT 'announcement',
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_classroom_posts_classroom ON public.classroom_posts(classroom_id, created_at DESC);

-- 5. Ensure `submission_answers` has `research_grades` for IRR / Research Co-evaluators
ALTER TABLE IF EXISTS public.submission_answers
ADD COLUMN IF NOT EXISTS research_grades JSONB DEFAULT '{}'::jsonb;

-- 6. Create indexes for high-speed queries
CREATE INDEX IF NOT EXISTS idx_users_institution ON public.users(institution);
CREATE INDEX IF NOT EXISTS idx_users_student_id ON public.users(student_id);
CREATE INDEX IF NOT EXISTS idx_users_line_uid ON public.users(line_uid);

-- Prevent future duplicate student accounts when the same LINE identity opens LIFF
-- from LINE and an external browser. If old duplicates exist, clean them up first;
-- this block keeps the migration non-destructive and reports that condition.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.users
    WHERE line_uid IS NOT NULL
    GROUP BY line_uid
    HAVING COUNT(*) > 1
  ) THEN
    RAISE NOTICE 'Duplicate line_uid rows exist; unique index was not created. Review them before retrying.';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_line_uid_unique
      ON public.users(line_uid)
      WHERE line_uid IS NOT NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_classroom_students_status ON public.classroom_students(status);
CREATE INDEX IF NOT EXISTS idx_classroom_students_classroom_id ON public.classroom_students(classroom_id);

-- 7. Enable Full Replica Identity for Realtime tracking
ALTER TABLE IF EXISTS public.users REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS public.classrooms REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS public.classroom_students REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS public.attendance_sessions REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS public.attendance_records REPLICA IDENTITY FULL;
ALTER TABLE IF EXISTS public.classroom_posts REPLICA IDENTITY FULL;

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
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.attendance_sessions;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.attendance_records;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.classroom_posts;
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
WHERE table_name IN ('users', 'classrooms', 'courses', 'classroom_students', 'attendance_sessions', 'attendance_records', 'classroom_posts', 'submission_answers')
  AND column_name IN ('first_name', 'last_name', 'student_id', 'institution', 'pending_students', 'teachers', 'status', 'research_grades', 'line_group_id', 'line_connection_status', 'line_connection_token_hash', 'line_connection_token', 'line_connection_token_expires_at', 'line_connected_at')
ORDER BY table_name, column_name;

-- ==============================================================================
-- Automatic LINE linking (no pairing codes)
-- Teachers are linked from their LINE sign-in; groups link when the bot joins a
-- group that a waiting classroom's teacher is in, and unlink when it leaves.
-- ==============================================================================
ALTER TABLE IF EXISTS public.users
ADD COLUMN IF NOT EXISTS line_bot_friend BOOLEAN DEFAULT FALSE;

ALTER TABLE IF EXISTS public.classrooms
ADD COLUMN IF NOT EXISTS line_group_name TEXT;

CREATE INDEX IF NOT EXISTS idx_classrooms_line_group_id ON public.classrooms(line_group_id);
CREATE INDEX IF NOT EXISTS idx_classrooms_line_connection_status ON public.classrooms(line_connection_status);

-- ==============================================================================
-- Server (service_role) privileges
-- API routes (/api/submissions, /api/attendance, /api/line/*) use the service
-- role key. Without these grants they fail with "permission denied for table"
-- (42501): LIFF submissions fail and teacher LINE linking never completes.
-- ==============================================================================
GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;

-- ==============================================================================
-- Course assessment framework mode (ตัวชี้วัด vs สมรรถนะ)
-- The course wizard and course settings save these; without them every course
-- insert fails with "Could not find the 'indicator_mode' column".
-- ==============================================================================
ALTER TABLE IF EXISTS public.courses
ADD COLUMN IF NOT EXISTS indicator_mode TEXT NOT NULL DEFAULT 'indicator',
ADD COLUMN IF NOT EXISTS lesson_plans JSONB NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'courses_indicator_mode_check') THEN
    ALTER TABLE public.courses
      ADD CONSTRAINT courses_indicator_mode_check CHECK (indicator_mode IN ('indicator', 'competency'));
  END IF;
END $$;

-- ==============================================================================
-- Indexes for scoped reads
-- Pages load only the signed-in teacher's (or student's) rows: by owner id, by
-- co-teacher / roster membership inside JSONB, and submissions by student.
-- ==============================================================================
CREATE INDEX IF NOT EXISTS idx_courses_primary_teacher ON public.courses(primary_teacher_id);
CREATE INDEX IF NOT EXISTS idx_classrooms_teacher ON public.classrooms(teacher_id);
CREATE INDEX IF NOT EXISTS idx_courses_teachers_gin ON public.courses USING GIN (teachers jsonb_path_ops);
CREATE INDEX IF NOT EXISTS idx_classrooms_teachers_gin ON public.classrooms USING GIN (teachers jsonb_path_ops);
CREATE INDEX IF NOT EXISTS idx_classrooms_students_gin ON public.classrooms USING GIN (students jsonb_path_ops);
CREATE INDEX IF NOT EXISTS idx_classrooms_pending_students_gin ON public.classrooms USING GIN (pending_students jsonb_path_ops);
CREATE INDEX IF NOT EXISTS idx_submissions_assignment_student ON public.submissions(assignment_id, student_id);
CREATE INDEX IF NOT EXISTS idx_attendance_records_classroom_student ON public.attendance_records(classroom_id, student_id);

-- Make PostgREST pick up the new columns immediately.
NOTIFY pgrst, 'reload schema';

-- ==========================================
-- Multiple LINE reminders per assignment
-- ==========================================
-- Every selected reminder offset (minutes before the deadline).
-- reminder_offset_minutes keeps the earliest one for older code.
ALTER TABLE public.assignments
ADD COLUMN IF NOT EXISTS reminder_offsets_minutes INTEGER[];

-- ==========================================
-- Required / optional homework questions
-- ==========================================
-- Homework questions are required unless the teacher marks them optional.
-- Quizzes ignore this: students may hand in an unfinished quiz after confirming.
ALTER TABLE public.questions
ADD COLUMN IF NOT EXISTS is_required BOOLEAN NOT NULL DEFAULT TRUE;

-- ==========================================
-- Scheduled assignment release
-- ==========================================
-- Students see (and can submit) an assignment only from publish_at.
-- NULL = published when created. The LINE "new work" message is sent by the
-- reminder cron (supabase_reminder_cron.sql) once publish_at passes.
ALTER TABLE public.assignments
ADD COLUMN IF NOT EXISTS publish_at TIMESTAMPTZ;

-- ==========================================
-- Teacher LINE id kept apart from the student identity
-- ==========================================
-- users.line_uid identifies a student's LIFF login. A teacher who also uses
-- the student app (allowed for testing) shares the same LINE id, so teacher
-- rows keep theirs in teacher_line_uid instead and line_uid stays the student's.
ALTER TABLE IF EXISTS public.users
ADD COLUMN IF NOT EXISTS teacher_line_uid TEXT;

UPDATE public.users
SET teacher_line_uid = line_uid
WHERE role = 'teacher' AND line_uid IS NOT NULL AND teacher_line_uid IS NULL;

UPDATE public.users
SET line_uid = NULL
WHERE role = 'teacher' AND line_uid IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_teacher_line_uid_unique
  ON public.users(teacher_line_uid)
  WHERE teacher_line_uid IS NOT NULL;

-- Teachers whose teacher_line_uid was backfilled above never got the connected
-- flags; the app only repairs them on their next dashboard visit.
UPDATE public.users
SET is_line_connected = TRUE,
    line_link_status = 'connected',
    updated_at = NOW()
WHERE role = 'teacher'
  AND teacher_line_uid IS NOT NULL
  AND (is_line_connected IS DISTINCT FROM TRUE OR line_link_status IS DISTINCT FROM 'connected');
