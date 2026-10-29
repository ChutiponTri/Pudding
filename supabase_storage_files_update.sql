-- ==============================================================================
-- R2 file tracking (stored_files)
-- One row per object uploaded to Cloudflare R2, so the app can:
--   * delete a student's replaced or abandoned (never submitted) uploads,
--   * delete every file of an assignment / classroom when it is deleted,
--   * spot duplicate uploads (same student, same assignment, same file),
--   * let admins back files up (download as ZIP) and track which are backed up.
-- Rows are kept after their object is deleted (status = 'deleted') as history.
-- Run this in your Supabase SQL Editor. Safe to re-run.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.stored_files (
  key TEXT PRIMARY KEY,                      -- object key inside the R2 bucket
  url TEXT NOT NULL,                         -- public URL saved in answers / assignments
  purpose TEXT NOT NULL DEFAULT 'submission',-- submission | sample (teacher reference work)
  owner_id TEXT,                             -- users.id of the uploader (student or teacher)
  assignment_id TEXT,                        -- no FK: the app deletes the object before the row goes
  content_type TEXT,
  size_bytes BIGINT,
  sha256 TEXT,                               -- hash of the file the user picked (duplicate check)
  original_filename TEXT,
  -- uploading: URL handed out, not confirmed yet
  -- draft:     uploaded, not part of a submitted answer / saved assignment yet
  -- attached:  in use by a submission or an assignment
  -- orphan:    found in the bucket with nothing pointing at it (admin sync)
  -- deleted:   object removed from R2
  status TEXT NOT NULL DEFAULT 'uploading',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attached_at TIMESTAMPTZ,
  backed_up_at TIMESTAMPTZ,                  -- NULL = not backed up yet
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_stored_files_assignment ON public.stored_files(assignment_id);
CREATE INDEX IF NOT EXISTS idx_stored_files_owner_assignment ON public.stored_files(owner_id, assignment_id);
CREATE INDEX IF NOT EXISTS idx_stored_files_status_created ON public.stored_files(status, created_at);
CREATE INDEX IF NOT EXISTS idx_stored_files_url ON public.stored_files(url);

-- Server-only table (the app uses the service key); closed to the public keys.
ALTER TABLE public.stored_files ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stored_files FROM anon, authenticated;
