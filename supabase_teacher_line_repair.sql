-- ==============================================================================
-- Repair teacher accounts that hold a student LINE id
-- Before teacher_line_uid existed, a teacher who also opened the student LIFF
-- app had their teacher row (Clerk id "user_…") found by line_uid and saved as
-- a student. Such rows keep flipping between teacher and student.
-- The app now repairs a row the next time it meets it; this fixes all at once.
-- Run step 1 first to see who is affected. Safe to re-run.
-- ==============================================================================

-- 1. Who is affected (Clerk ids start with "user_"; LINE student ids start with "U").
SELECT id, role, first_name, last_name, email, line_uid, teacher_line_uid
FROM public.users
WHERE id LIKE 'user\_%' AND (line_uid IS NOT NULL OR role IS DISTINCT FROM 'teacher');

-- 1b. Student activity recorded under a teacher account while it was flipped
--     (worth a look; the app does not move it).
SELECT 'submissions' AS what, count(*) FROM public.submissions WHERE student_id LIKE 'user\_%'
UNION ALL
SELECT 'attendance_records', count(*) FROM public.attendance_records WHERE student_id LIKE 'user\_%'
UNION ALL
SELECT 'classroom_students', count(*) FROM public.classroom_students WHERE student_id LIKE 'user\_%';

-- 2. Repair: back to teacher, LINE id moved to teacher_line_uid (unless another
--    teacher row already owns it), line_uid freed for the person's student account.
UPDATE public.users u
SET teacher_line_uid = CASE
      WHEN u.teacher_line_uid IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.users o WHERE o.teacher_line_uid = u.line_uid AND o.id <> u.id)
      THEN u.line_uid
      ELSE u.teacher_line_uid
    END,
    role = 'teacher',
    line_uid = NULL,
    updated_at = NOW()
WHERE u.id LIKE 'user\_%' AND (u.line_uid IS NOT NULL OR u.role IS DISTINCT FROM 'teacher');

UPDATE public.users
SET is_line_connected = TRUE, line_link_status = 'connected', updated_at = NOW()
WHERE id LIKE 'user\_%' AND teacher_line_uid IS NOT NULL
  AND (is_line_connected IS DISTINCT FROM TRUE OR line_link_status IS DISTINCT FROM 'connected');
