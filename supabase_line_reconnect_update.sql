-- ==============================================================================
-- LINE group auto-reconnect
-- When the bot is removed from a classroom's LINE group, the classroom is
-- unlinked but remembers the group (line_last_group_*). If the bot is added
-- back to the same group, the webhook links the classroom again by itself and
-- keeps the group's old `ref`, so the menu and connect buttons already posted
-- (and pinned) in the group keep working.
-- An intentional unlink (web "ยกเลิกการเชื่อม") forgets the group instead.
-- Run this in your Supabase SQL Editor. Safe to re-run.
-- ==============================================================================

ALTER TABLE public.classrooms ADD COLUMN IF NOT EXISTS line_last_group_id TEXT;
ALTER TABLE public.classrooms ADD COLUMN IF NOT EXISTS line_last_group_name TEXT;
ALTER TABLE public.classrooms ADD COLUMN IF NOT EXISTS line_last_group_ref TEXT;

CREATE INDEX IF NOT EXISTS idx_classrooms_line_last_group_id
  ON public.classrooms(line_last_group_id)
  WHERE line_last_group_id IS NOT NULL;
