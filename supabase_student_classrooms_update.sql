-- ==============================================================================
-- Student home without the rest of the class's roster (Supabase egress).
-- classrooms.students / pending_students hold every student of the class
-- (~12 KB per classroom, mostly photo links). The LIFF home only needs the
-- student's own entries, yet read whole rows for each of their classrooms on
-- every load. student_classroom_rows returns the same rows with both arrays
-- filtered inside Postgres to entries whose id or line_uid is one of the
-- student's keys, or whose student_id is one of their school numbers (the app
-- then keeps exactly the entries it kept before).
-- Until this is run the app reads the full rows as before.
-- Run this in your Supabase SQL Editor. Safe to re-run.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.own_roster_entries(p_list JSONB, p_keys TEXT[], p_numbers TEXT[])
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN jsonb_typeof(p_list) = 'array' THEN COALESCE((
      SELECT jsonb_agg(entry ORDER BY position)
      FROM jsonb_array_elements(p_list) WITH ORDINALITY AS t(entry, position)
      WHERE jsonb_typeof(entry) = 'object'
        AND (entry->>'id' = ANY(p_keys) OR entry->>'line_uid' = ANY(p_keys) OR entry->>'student_id' = ANY(p_numbers))
    ), '[]'::jsonb)
    ELSE p_list
  END
$$;

CREATE OR REPLACE FUNCTION public.student_classroom_rows(p_ids TEXT[], p_keys TEXT[], p_numbers TEXT[])
RETURNS SETOF JSONB
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT to_jsonb(c) || jsonb_build_object(
    'students', public.own_roster_entries(c.students, p_keys, p_numbers),
    'pending_students', public.own_roster_entries(c.pending_students, p_keys, p_numbers)
  )
  FROM public.classrooms c
  WHERE c.id::text = ANY(p_ids)
$$;

-- Only the server (service role) may call these: they read any classroom.
REVOKE ALL ON FUNCTION public.own_roster_entries(JSONB, TEXT[], TEXT[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.student_classroom_rows(TEXT[], TEXT[], TEXT[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.own_roster_entries(JSONB, TEXT[], TEXT[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.student_classroom_rows(TEXT[], TEXT[], TEXT[]) TO service_role;

-- PostgREST picks up the new function.
NOTIFY pgrst, 'reload schema';
