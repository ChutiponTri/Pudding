-- ==============================================================================
-- LINE group join burst tracking
-- When many students join the LINE group within a few seconds, the bot replies
-- to the first one immediately and sends one follow-up after the last one,
-- instead of posting the classroom link for every join.
-- Run this in your Supabase SQL Editor.
-- ==============================================================================

ALTER TABLE public.classrooms ADD COLUMN IF NOT EXISTS line_member_joined_at TIMESTAMPTZ;
ALTER TABLE public.classrooms ADD COLUMN IF NOT EXISTS line_join_notice_pending BOOLEAN DEFAULT FALSE;
