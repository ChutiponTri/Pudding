-- ==============================================================================
-- Per-student time limit for "Allow edit" / "Allow hand-in"
-- When the teacher lets one student hand in again close to (or after) the
-- deadline, they pick how many minutes that student gets. This column holds
-- the end of that window. NULL = no limit (the permission lasts until the
-- student hands in, or the teacher closes the work).
-- The teacher may now also let a student who was recorded as "no submission"
-- (status 'pending', 0 points) hand in, using the same columns.
-- Requires supabase_submission_reopen_update.sql (reopened_at).
-- Run this in your Supabase SQL Editor.
-- ==============================================================================

ALTER TABLE public.submissions
ADD COLUMN IF NOT EXISTS reopened_at TIMESTAMPTZ;

ALTER TABLE public.submissions
ADD COLUMN IF NOT EXISTS reopen_until TIMESTAMPTZ;
