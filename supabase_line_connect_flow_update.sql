-- ==============================================================================
-- LINE group linking: pick the group and the classroom directly
-- Teachers link a classroom to a LINE group by choosing both on the LIFF page
-- (/liff/connect, opened from the bot's "เชื่อมห้องเรียน" button in a group or
-- the rich menu) or in the web dialog. Nothing waits for a message any more.
--
--   line_bot_groups  every group the bot is in (added on join, removed on
--                    leave). `ref` is a random id used in links instead of the
--                    LINE group id; the server still asks LINE whether the
--                    teacher is a member before linking.
--
-- Also clears old "waiting" requests, and removes the tables from the earlier
-- version of this script (line_pending_groups, line_link_tokens) if you ran it.
-- Run this in your Supabase SQL Editor. Safe to re-run.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.line_bot_groups (
  group_id TEXT PRIMARY KEY,
  ref TEXT NOT NULL UNIQUE,
  group_name TEXT,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_line_bot_groups_joined ON public.line_bot_groups(joined_at DESC);

-- Carry over groups recorded by the earlier version of this script.
DO $$
BEGIN
  IF to_regclass('public.line_pending_groups') IS NOT NULL THEN
    INSERT INTO public.line_bot_groups (group_id, ref, group_name, joined_at)
    SELECT group_id, replace(gen_random_uuid()::text, '-', ''), group_name, joined_at
    FROM public.line_pending_groups
    ON CONFLICT (group_id) DO NOTHING;
    DROP TABLE public.line_pending_groups;
  END IF;
END $$;
DROP TABLE IF EXISTS public.line_link_tokens;

-- Groups already linked to a classroom (the bot is in them).
INSERT INTO public.line_bot_groups (group_id, ref, group_name)
SELECT line_group_id, replace(gen_random_uuid()::text, '-', ''), line_group_name
FROM public.classrooms
WHERE line_group_id IS NOT NULL
ON CONFLICT (group_id) DO NOTHING;

-- Old "press connect, then message the group" requests no longer do anything.
UPDATE public.classrooms
SET line_connection_status = 'disconnected',
    line_connection_token = NULL,
    line_connection_token_hash = NULL,
    line_connection_token_expires_at = NULL
WHERE line_connection_status = 'waiting' AND line_group_id IS NULL;

-- Server (service_role) only, like every other table after the security lockdown.
ALTER TABLE public.line_bot_groups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.line_bot_groups FROM anon, authenticated;
