-- ==============================================================================
-- One classroom per LINE group
-- The webhook already refuses to link a group that belongs to another classroom
-- (and asks the teacher before moving an old group to a new semester). This
-- index makes the database enforce it too. If old duplicates exist, the block
-- reports them instead of failing; unlink the extra classrooms and run it again.
-- Run this in your Supabase SQL Editor.
-- ==============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.classrooms
    WHERE line_group_id IS NOT NULL
    GROUP BY line_group_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE NOTICE 'Several classrooms share a LINE group; unique index was not created. Review them before retrying.';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS idx_classrooms_line_group_id_unique
      ON public.classrooms(line_group_id)
      WHERE line_group_id IS NOT NULL;
  END IF;
END $$;
