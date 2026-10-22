-- ==============================================================================
-- Assignment order inside a classroom group
-- Teachers drag work cards to reorder them in the classroom's "งานและเนื้อหา"
-- tab. Lower numbers come first; NULL (new work) is shown at the top.
-- Run this in your Supabase SQL Editor.
-- ==============================================================================

ALTER TABLE public.assignments
ADD COLUMN IF NOT EXISTS sort_order INTEGER;
