-- ==============================================================================
-- ถังขยะ (trash): deleted classrooms and work are kept for 7 days.
-- Deleting a classroom or a work saves a copy of all its rows here (payload),
-- then removes them as before. The teacher can restore it from /trash on the
-- website, or delete it for good; after expires_at the app deletes it and its
-- uploaded files automatically. TAs / co-teachers of the classroom also see
-- and can restore it; only the teacher who deleted it can delete it for good.
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

-- Teachers of the classroom when it was deleted (owner + TA/co-teachers):
-- they all see the item in their trash and can restore it.
ALTER TABLE public.trash_items ADD COLUMN IF NOT EXISTS teacher_ids TEXT[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_trash_items_teacher_ids ON public.trash_items USING GIN (teacher_ids);

-- Fill it for items deleted before this column existed: the deleted classroom's
-- copy (classroom items) or the classroom the work belongs to (work items).
UPDATE public.trash_items t
SET teacher_ids = (
  SELECT COALESCE(array_agg(DISTINCT v) FILTER (WHERE v IS NOT NULL AND v <> ''), '{}')
  FROM (
    SELECT t.owner_id AS v
    UNION ALL SELECT r.room->>'teacher_id'
    UNION ALL SELECT e->>'teacher_id' FROM jsonb_array_elements(COALESCE(r.room->'teachers', '[]'::jsonb)) e
  ) ids
)
FROM (
  SELECT ti.id, COALESCE(ti.payload->'classrooms'->0, to_jsonb(c)) AS room
  FROM public.trash_items ti
  LEFT JOIN public.classrooms c ON c.id = ti.classroom_id
) r
WHERE r.id = t.id AND t.teacher_ids = '{}';

-- Server-only table (the app uses the service key); closed to the public keys.
ALTER TABLE public.trash_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.trash_items FROM anon, authenticated;
