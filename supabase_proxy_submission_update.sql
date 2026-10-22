-- ==============================================================================
-- Borrowed-phone submissions
-- A student whose phone is broken may hand in work, a quiz or an attendance
-- check-in for themself from a classmate's phone (same school, same classroom).
-- The row still belongs to the student; these columns record whose phone
-- (users.id) sent it so the teacher can see it. NULL = sent from their own phone.
-- Run this in your Supabase SQL Editor.
-- ==============================================================================

ALTER TABLE public.submissions
ADD COLUMN IF NOT EXISTS submitted_by TEXT REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.attendance_records
ADD COLUMN IF NOT EXISTS checked_in_by TEXT REFERENCES public.users(id) ON DELETE SET NULL;
