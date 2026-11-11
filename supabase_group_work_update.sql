-- ==============================================================================
-- งานกลุ่ม (group homework): students form their own groups before handing in.
-- assignments.group_size: NULL = individual work, 2+ = group work with at most
-- that many students per group. One member hands in for the whole group; the
-- app copies the work (and later the grades) to every member's own submission,
-- so the grade book and exports stay per student.
-- work_group_members' primary key (assignment, student) means a student can be
-- in only one group per work, even when two phones pick them at the same time.
-- Run this in your Supabase SQL Editor. Safe to re-run.
-- ==============================================================================

ALTER TABLE public.assignments ADD COLUMN IF NOT EXISTS group_size INTEGER;

CREATE TABLE IF NOT EXISTS public.work_groups (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES public.assignments(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_by TEXT,                 -- users.id of the student who made it
  submitted_by TEXT,               -- users.id of the member who last handed in for the group
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_work_groups_assignment ON public.work_groups(assignment_id);

CREATE TABLE IF NOT EXISTS public.work_group_members (
  assignment_id TEXT NOT NULL REFERENCES public.assignments(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL,        -- roster id (users.id)
  group_id TEXT NOT NULL REFERENCES public.work_groups(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (assignment_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_work_group_members_group ON public.work_group_members(group_id);

-- Only the server (service role) reads and writes these, like every other table.
ALTER TABLE public.work_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_group_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.work_groups FROM anon, authenticated;
REVOKE ALL ON public.work_group_members FROM anon, authenticated;
