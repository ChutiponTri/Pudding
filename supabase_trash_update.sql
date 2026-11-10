-- ==============================================================================
-- ถังขยะ (trash): deleted classrooms and work are kept for 7 days.
-- Deleting a classroom or a work saves a copy of all its rows here (payload),
-- then removes them as before. The teacher can restore it from /trash on the
-- website, or delete it for good; after expires_at the app deletes it and its
-- uploaded files automatically.
-- Run this in your Supabase SQL Editor. Safe to re-run.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.trash_items (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('assignment', 'classroom')),
  item_id TEXT NOT NULL,                       -- assignments.id / classrooms.id it was
  owner_id TEXT NOT NULL,                      -- users.id of the teacher who deleted it
  title TEXT NOT NULL DEFAULT '',
  subtitle TEXT NOT NULL DEFAULT '',           -- classroom / course name, for the list
  classroom_id TEXT,                           -- work: the classroom it belonged to
  payload JSONB NOT NULL,                      -- { table: rows[] } to put back on restore
  file_keys JSONB NOT NULL DEFAULT '[]'::jsonb, -- R2 objects removed when it expires
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_trash_items_owner ON public.trash_items(owner_id, deleted_at DESC);
CREATE INDEX IF NOT EXISTS idx_trash_items_expires ON public.trash_items(expires_at);

-- Server-only table (the app uses the service key); closed to the public keys.
ALTER TABLE public.trash_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.trash_items FROM anon, authenticated;
