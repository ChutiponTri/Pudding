-- ==============================================================================
-- Flexible LINE group linking
-- A classroom can now be linked from the web, from the teacher's LIFF page
-- (rich menu "เชื่อมกลุ่ม"), or from the group itself (bot's "เชื่อมห้องเรียน"
-- button), in any order. Two small tables support it:
--
--   line_pending_groups  groups the bot is in that are not linked yet, so the
--                        web and LIFF page can offer them for a one-click link
--                        (added on join, removed on link/leave)
--   line_link_tokens     single-use, 30-minute links from the bot's
--                        "สร้างห้องเรียนใหม่" button: the classroom created
--                        with it links to that group (only the hash is stored)
--
-- Without this script linking still works, but the web/LIFF page cannot offer
-- groups the bot is already in, and "สร้างห้องเรียนใหม่" opens the form without
-- linking. Run this in your Supabase SQL Editor. Safe to re-run.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.line_pending_groups (
  group_id TEXT PRIMARY KEY,
  group_name TEXT,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  prompted_at TIMESTAMPTZ                 -- first teacher message got the "เชื่อมห้องเรียน" button
);
CREATE INDEX IF NOT EXISTS idx_line_pending_groups_joined ON public.line_pending_groups(joined_at DESC);

CREATE TABLE IF NOT EXISTS public.line_link_tokens (
  token_hash TEXT PRIMARY KEY,            -- sha256 of the token in the link
  group_id TEXT NOT NULL,
  teacher_id TEXT NOT NULL,               -- only this teacher can use it
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_line_link_tokens_expires ON public.line_link_tokens(expires_at);

-- Old tokens are useless after 30 minutes; clear anything older than a day.
DELETE FROM public.line_link_tokens WHERE expires_at < NOW() - INTERVAL '1 day';

-- Server (service_role) only, like every other table after the security lockdown.
ALTER TABLE public.line_pending_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.line_link_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.line_pending_groups FROM anon, authenticated;
REVOKE ALL ON public.line_link_tokens FROM anon, authenticated;
