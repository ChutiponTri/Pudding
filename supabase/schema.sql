-- ==============================================================================
-- OMURICE PLATFORM : DATABASE SCHEMA (SUPABASE POSTGRESQL)
-- Intelligent Learning Assessment, Co-Teaching & Integrity Management
-- Designed for Teacher Web Portal & Student LINE LIFF Mobile App
-- ==============================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==============================================================================
-- 2. USERS (Teachers, Students & Admins)
-- Includes LINE LIFF UID mapping for seamless student LINE integration
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.users (
  id TEXT PRIMARY KEY,
  clerk_id TEXT UNIQUE,                       -- Clerk User ID (e.g. user_2xxx...)
  line_uid TEXT UNIQUE,                       -- LINE User ID from LINE LIFF (e.g. U1234567890abcdef...)
  student_id TEXT,                            -- Student identification number (e.g. 54101)
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('teacher', 'student', 'admin')),
  avatar_url TEXT,
  email TEXT,
  is_line_connected BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast LINE LIFF lookup
ALTER TABLE IF EXISTS public.users ADD COLUMN IF NOT EXISTS clerk_id TEXT UNIQUE;
CREATE INDEX IF NOT EXISTS idx_users_clerk_id ON public.users(clerk_id);
CREATE INDEX IF NOT EXISTS idx_users_line_uid ON public.users(line_uid);
CREATE INDEX IF NOT EXISTS idx_users_role ON public.users(role);

-- ==============================================================================
-- 3. COURSES (Parent Course Hierarchy)
-- Groups sections & assignments, holds OBEC learning indicators and co-teachers
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.courses (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,                         -- Course code (e.g. ท31101, ท31102)
  name TEXT NOT NULL,                         -- Course name (e.g. ภาษาไทยเพื่อการสื่อสารร่วมสมัย)
  description TEXT,
  academic_year TEXT NOT NULL,                -- Academic period (e.g. ภาคเรียนที่ 1 / 2569)
  semester INTEGER NOT NULL DEFAULT 1,
  year_ce INTEGER NOT NULL DEFAULT 2026,
  primary_teacher_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  teachers JSONB DEFAULT '[]'::JSONB,         -- Co-teachers & roles list [{teacher_id, name, role, email}]
  indicators JSONB DEFAULT '[]'::JSONB,       -- Standard OBEC Indicators & rubric weights [{id, code, title, weight}]
  classroom_ids JSONB DEFAULT '[]'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_courses_code ON public.courses(code);
CREATE INDEX IF NOT EXISTS idx_courses_semester_year ON public.courses(semester, year_ce);

-- ==============================================================================
-- 4. LEARNING INDICATORS (Normalized Table for Indicator Management)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.learning_indicators (
  id TEXT PRIMARY KEY,
  course_id TEXT REFERENCES public.courses(id) ON DELETE CASCADE,
  teacher_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  code TEXT NOT NULL,                         -- Standard code (e.g. ท 1.1 ม.4/1)
  title TEXT NOT NULL,                        -- Description / Competency
  subject TEXT,
  weight NUMERIC DEFAULT 0,                   -- Percentage weight (e.g. 35)
  order_index INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_indicators_course ON public.learning_indicators(course_id);

-- ==============================================================================
-- 5. CLASSROOMS (Sections & Student Groups)
-- Belongs to a Course; holds invite code for student LINE LIFF enrollment
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.classrooms (
  id TEXT PRIMARY KEY,
  course_id TEXT REFERENCES public.courses(id) ON DELETE SET NULL,
  course_name TEXT,
  teacher_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  teachers JSONB DEFAULT '[]'::JSONB,         -- Multi-teacher / co-teaching list
  name TEXT NOT NULL,                         -- Section name (e.g. ม.4/1 แผนภาษา-การสื่อสาร)
  academic_year TEXT NOT NULL,
  semester INTEGER NOT NULL DEFAULT 1,
  year_ce INTEGER NOT NULL DEFAULT 2026,
  student_count INTEGER DEFAULT 0,
  subject_code TEXT,
  invite_code TEXT UNIQUE,                    -- Invite code for LINE LIFF join (e.g. THAI-401)
  students JSONB DEFAULT '[]'::JSONB,         -- Cached roster snapshot
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_classrooms_course ON public.classrooms(course_id);
CREATE INDEX IF NOT EXISTS idx_classrooms_invite_code ON public.classrooms(invite_code);

-- ==============================================================================
-- 6. CLASSROOM_STUDENTS (Join Table for Student Enrollment & LINE LIFF)
-- Tracks how each student enrolled in the classroom
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.classroom_students (
  id TEXT PRIMARY KEY DEFAULT ('cs_' || substr(md5(random()::text), 1, 12)),
  classroom_id TEXT NOT NULL REFERENCES public.classrooms(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  joined_via TEXT DEFAULT 'manual' CHECK (joined_via IN ('line_liff', 'invite_code', 'manual', 'email')),
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(classroom_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_cs_classroom ON public.classroom_students(classroom_id);
CREATE INDEX IF NOT EXISTS idx_cs_student ON public.classroom_students(student_id);

-- ==============================================================================
-- 7. ASSIGNMENTS (Homework & Online Exams)
-- Supports manual submission override (auto / force_closed / extended)
-- and optional sample work reference attachments
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.assignments (
  id TEXT PRIMARY KEY,
  course_id TEXT REFERENCES public.courses(id) ON DELETE SET NULL,
  classroom_id TEXT NOT NULL REFERENCES public.classrooms(id) ON DELETE CASCADE,
  classroom_name TEXT,
  title TEXT NOT NULL,
  description TEXT,
  is_exam BOOLEAN NOT NULL DEFAULT FALSE,
  due_date TIMESTAMPTZ NOT NULL,
  reminder_cron TEXT DEFAULT '0 18 * * *',    -- Cron schedule for LINE reminders
  total_points NUMERIC DEFAULT 20,
  status_override TEXT DEFAULT 'auto' CHECK (status_override IN ('auto', 'force_closed', 'extended')),
  extended_until TIMESTAMPTZ,
  sample_work_url TEXT,                       -- Reference material (active in assignment, disabled in exam)
  sample_work_title TEXT,
  sample_work_description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assignments_classroom ON public.assignments(classroom_id);
CREATE INDEX IF NOT EXISTS idx_assignments_course ON public.assignments(course_id);

-- ==============================================================================
-- 8. QUESTIONS (Assessment Items)
-- Supports multiple choice, short answer, file upload (R2), and true/false
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.questions (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES public.assignments(id) ON DELETE CASCADE,
  indicator_id TEXT,
  type TEXT NOT NULL CHECK (type IN ('multiple_choice', 'short_answer', 'file_upload', 'true_false')),
  question_text TEXT NOT NULL,
  options JSONB DEFAULT '[]'::JSONB,          -- For multiple choice items
  ideal_answer TEXT,                          -- Model answer for AI ASAG scoring
  rubric_criteria TEXT,                       -- Scoring criteria guide
  max_score NUMERIC NOT NULL DEFAULT 5,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_questions_assignment ON public.questions(assignment_id);

-- ==============================================================================
-- 9. SUBMISSIONS (Student Task Submissions)
-- Tracks anti-cheating metrics (tab switches, time away) & grading status
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.submissions (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES public.assignments(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'submitted', 'late')),
  started_at TIMESTAMPTZ DEFAULT NOW(),
  submitted_at TIMESTAMPTZ,
  time_spent_seconds INTEGER DEFAULT 0,
  tab_switch_count INTEGER DEFAULT 0,
  total_time_away_seconds INTEGER DEFAULT 0,
  is_flagged_suspicious BOOLEAN DEFAULT FALSE,
  total_score NUMERIC,
  max_total_score NUMERIC DEFAULT 20,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(assignment_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_submissions_assignment ON public.submissions(assignment_id);
CREATE INDEX IF NOT EXISTS idx_submissions_student ON public.submissions(student_id);

-- ==============================================================================
-- 10. SUBMISSION_ANSWERS (Item-by-Item Answers & Co-Teacher IRR Scores)
-- Student text, Cloudflare R2 file uploads, AI feedback & independent Co-Grades
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.submission_answers (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES public.submissions(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  text_answer TEXT,
  file_url TEXT,                              -- Cloudflare R2 public URL
  ai_mock_score NUMERIC,
  ai_confidence NUMERIC,                      -- 0.0 to 1.0 (e.g. 0.94 = 94%)
  ai_feedback TEXT,
  teacher_score NUMERIC,                      -- Student-facing official score (from primary teacher)
  teacher_comment TEXT,                       -- Student-facing official feedback (from primary teacher)
  co_grades JSONB DEFAULT '{}'::JSONB,        -- Independent ratings by assistant teachers for IRR research
  graded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(submission_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_answers_submission ON public.submission_answers(submission_id);

-- ==============================================================================
-- 11. SUBMISSION_EVENTS (Anti-Cheating & Integrity Audit Logs)
-- Logs tab visibility, blur, focus, paste and copy attempts during exams
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.submission_events (
  id TEXT PRIMARY KEY DEFAULT ('evt_' || substr(md5(random()::text), 1, 12)),
  submission_id TEXT NOT NULL REFERENCES public.submissions(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('tab_hidden', 'window_blur', 'tab_visible', 'window_focus', 'copy_attempt', 'paste_attempt')),
  away_duration_seconds INTEGER DEFAULT 0,
  details TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_submission ON public.submission_events(submission_id);

-- ==============================================================================
-- 12. ROW LEVEL SECURITY (RLS) POLICIES
-- Enables open read/write for development with anon key; ready for auth enhancement
-- ==============================================================================
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_indicators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classrooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classroom_students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submission_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submission_events ENABLE ROW LEVEL SECURITY;

-- Development policies (allow all operations via anon key / authenticated clients)
CREATE POLICY "Public Read users" ON public.users FOR SELECT USING (true);
CREATE POLICY "Public Insert users" ON public.users FOR INSERT WITH CHECK (true);
CREATE POLICY "Public Update users" ON public.users FOR UPDATE USING (true);
CREATE POLICY "Public Delete users" ON public.users FOR DELETE USING (true);

CREATE POLICY "Public Read courses" ON public.courses FOR SELECT USING (true);
CREATE POLICY "Public Insert courses" ON public.courses FOR INSERT WITH CHECK (true);
CREATE POLICY "Public Update courses" ON public.courses FOR UPDATE USING (true);
CREATE POLICY "Public Delete courses" ON public.courses FOR DELETE USING (true);

CREATE POLICY "Public Read learning_indicators" ON public.learning_indicators FOR SELECT USING (true);
CREATE POLICY "Public Insert learning_indicators" ON public.learning_indicators FOR INSERT WITH CHECK (true);
CREATE POLICY "Public Update learning_indicators" ON public.learning_indicators FOR UPDATE USING (true);
CREATE POLICY "Public Delete learning_indicators" ON public.learning_indicators FOR DELETE USING (true);

CREATE POLICY "Public Read classrooms" ON public.classrooms FOR SELECT USING (true);
CREATE POLICY "Public Insert classrooms" ON public.classrooms FOR INSERT WITH CHECK (true);
CREATE POLICY "Public Update classrooms" ON public.classrooms FOR UPDATE USING (true);
CREATE POLICY "Public Delete classrooms" ON public.classrooms FOR DELETE USING (true);

CREATE POLICY "Public Read classroom_students" ON public.classroom_students FOR SELECT USING (true);
CREATE POLICY "Public Insert classroom_students" ON public.classroom_students FOR INSERT WITH CHECK (true);
CREATE POLICY "Public Update classroom_students" ON public.classroom_students FOR UPDATE USING (true);
CREATE POLICY "Public Delete classroom_students" ON public.classroom_students FOR DELETE USING (true);

CREATE POLICY "Public Read assignments" ON public.assignments FOR SELECT USING (true);
CREATE POLICY "Public Insert assignments" ON public.assignments FOR INSERT WITH CHECK (true);
CREATE POLICY "Public Update assignments" ON public.assignments FOR UPDATE USING (true);
CREATE POLICY "Public Delete assignments" ON public.assignments FOR DELETE USING (true);

CREATE POLICY "Public Read questions" ON public.questions FOR SELECT USING (true);
CREATE POLICY "Public Insert questions" ON public.questions FOR INSERT WITH CHECK (true);
CREATE POLICY "Public Update questions" ON public.questions FOR UPDATE USING (true);
CREATE POLICY "Public Delete questions" ON public.questions FOR DELETE USING (true);

CREATE POLICY "Public Read submissions" ON public.submissions FOR SELECT USING (true);
CREATE POLICY "Public Insert submissions" ON public.submissions FOR INSERT WITH CHECK (true);
CREATE POLICY "Public Update submissions" ON public.submissions FOR UPDATE USING (true);
CREATE POLICY "Public Delete submissions" ON public.submissions FOR DELETE USING (true);

CREATE POLICY "Public Read submission_answers" ON public.submission_answers FOR SELECT USING (true);
CREATE POLICY "Public Insert submission_answers" ON public.submission_answers FOR INSERT WITH CHECK (true);
CREATE POLICY "Public Update submission_answers" ON public.submission_answers FOR UPDATE USING (true);
CREATE POLICY "Public Delete submission_answers" ON public.submission_answers FOR DELETE USING (true);

CREATE POLICY "Public Read submission_events" ON public.submission_events FOR SELECT USING (true);
CREATE POLICY "Public Insert submission_events" ON public.submission_events FOR INSERT WITH CHECK (true);
CREATE POLICY "Public Update submission_events" ON public.submission_events FOR UPDATE USING (true);
CREATE POLICY "Public Delete submission_events" ON public.submission_events FOR DELETE USING (true);

-- ==============================================================================
-- 13. SEED DEFAULT TEACHER RECORD
-- Ensures teacher account exists for instant use in the portal
-- ==============================================================================
INSERT INTO public.users (id, first_name, last_name, role, email, avatar_url)
VALUES (
  'teacher-tippanan',
  'ธิปนรรจ์',
  'พรายหนู',
  'teacher',
  'tippanan.p@omurice.ac.th',
  'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150'
)
ON CONFLICT (id) DO UPDATE SET
  first_name = EXCLUDED.first_name,
  last_name = EXCLUDED.last_name,
  email = EXCLUDED.email;

-- Default Co-Teachers
INSERT INTO public.users (id, first_name, last_name, role, email, avatar_url)
VALUES 
  ('teacher-somchai', 'สมชาย', 'วิทยากร', 'teacher', 'somchai.w@omurice.ac.th', 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150'),
  ('teacher-pattra', 'ภัทรา', 'สิริวัฒน์', 'teacher', 'pattra.s@omurice.ac.th', 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=150')
ON CONFLICT (id) DO NOTHING;
