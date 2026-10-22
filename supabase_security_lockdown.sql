-- ==========================================
-- Security lockdown: close the database to the public (anon) key
-- ==========================================
-- ⚠️ Run this only AFTER the app version that routes all browser data access
-- through the server (/api/data) is deployed. Older app versions read and
-- write with the public key and stop working once this runs.
--
-- What it does:
--   * Enables Row Level Security on every table in the public schema.
--   * Drops every RLS policy there (the old "Public Read/Insert/Update/Delete"
--     development policies), so the anon and authenticated roles can no longer
--     read or change anything.
--   * The server keeps full access: it uses the service_role key, which
--     bypasses RLS.
-- Realtime *broadcast* (the app's live-update signals) does not touch tables
-- and keeps working.
--
-- Safe to re-run. To undo, re-create policies (see supabase/schema.sql §12).

DO $$
DECLARE
  t record;
  p record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;

  FOR p IN SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policyname, p.tablename);
  END LOOP;
END $$;

-- Belt and braces: the public roles get no table privileges either.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;

-- Check: should return no rows.
--   SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public';
-- And every table should show rowsecurity = true:
--   SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public';
