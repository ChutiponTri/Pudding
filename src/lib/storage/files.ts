import 'server-only';
import { DeleteObjectsCommand } from '@aws-sdk/client-s3';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isR2Configured, keyFromPublicUrl, r2Client, R2_BUCKET_NAME } from '@/lib/storage/r2Client';

/**
 * Bookkeeping for objects in R2 (table stored_files, see
 * supabase_storage_files_update.sql). Every helper is best effort: storage
 * cleanup never blocks a submission or a delete, and a database without the
 * table yet only loses the tracking, not the feature itself.
 */

type Supabase = SupabaseClient;

export type StoredFileStatus = 'uploading' | 'draft' | 'attached' | 'orphan' | 'deleted';

export interface StoredFile {
  key: string;
  url: string;
  purpose: 'submission' | 'sample';
  owner_id: string | null;
  assignment_id: string | null;
  content_type: string | null;
  size_bytes: number | null;
  sha256: string | null;
  original_filename: string | null;
  status: StoredFileStatus;
  created_at: string;
  attached_at: string | null;
  backed_up_at: string | null;
  deleted_at: string | null;
}

export const STORED_FILES = 'stored_files';
/** Uploads never handed in (quiz closed without submitting, failed save) are removed after this. */
export const DRAFT_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const OPEN_STATUSES: StoredFileStatus[] = ['uploading', 'draft'];
/** PostgREST `in.(…)` lists live in the URL, so keep each request reasonably small. */
const IN_CHUNK = 150;

let warnedMissingTable = false;
/** True (after one warning) when the database has no stored_files table yet. */
export function isMissingTable(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false;
  const missing = error.code === '42P01' || error.code === 'PGRST205' || !!error.message?.includes(STORED_FILES);
  if (missing && !warnedMissingTable) {
    warnedMissingTable = true;
    console.warn('[storage] stored_files table is missing; run supabase_storage_files_update.sql');
  }
  return missing;
}

const chunks = <T>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size));

export async function trackFile(supabase: Supabase, row: Partial<StoredFile> & { key: string; url: string }) {
  const { error } = await supabase.from(STORED_FILES).upsert(row);
  if (error && !isMissingTable(error)) console.warn('[storage] track failed:', error.message);
}

/** Deletes objects from R2 (1000 per request). Returns the keys R2 confirmed. */
export async function deleteObjects(keys: string[]): Promise<string[]> {
  const unique = [...new Set(keys.filter(Boolean))];
  if (!unique.length || !isR2Configured) return [];
  const deleted: string[] = [];
  for (const part of chunks(unique, 1000)) {
    try {
      const result = await r2Client.send(
        new DeleteObjectsCommand({ Bucket: R2_BUCKET_NAME, Delete: { Objects: part.map((Key) => ({ Key })), Quiet: false } })
      );
      deleted.push(...(result.Deleted || []).map((d) => d.Key!).filter(Boolean));
      for (const failure of result.Errors || []) console.warn('[storage] delete failed:', failure.Key, failure.Message);
    } catch (error) {
      console.error('[storage] delete request failed:', error);
    }
  }
  return deleted;
}

/** Deletes the objects and marks their rows deleted. Returns how many objects R2 removed. */
export async function removeFiles(supabase: Supabase, keys: string[]) {
  const deleted = await deleteObjects(keys);
  for (const part of chunks(deleted, IN_CHUNK)) {
    const { error } = await supabase
      .from(STORED_FILES)
      .update({ status: 'deleted', deleted_at: new Date().toISOString() })
      .in('key', part);
    if (error && !isMissingTable(error)) console.warn('[storage] mark deleted failed:', error.message);
  }
  return deleted.length;
}

/** R2 keys among these URLs (links to other sites are skipped). */
export const keysFromUrls = (urls: Array<string | null | undefined>) =>
  [...new Set(urls.map(keyFromPublicUrl).filter((key): key is string => !!key))];

/**
 * Every R2 key belonging to these assignments: tracked uploads, files in
 * students' answers (also older, untracked ones) and the reference work.
 * Collect them before deleting the rows, then pass them to removeFiles.
 */
export async function assignmentFileKeys(supabase: Supabase, assignmentIds: string[]): Promise<string[]> {
  if (!assignmentIds.length) return [];
  const keys = new Set<string>();
  for (const part of chunks(assignmentIds, IN_CHUNK)) {
    const [tracked, assignments, submissions] = await Promise.all([
      supabase.from(STORED_FILES).select('key').in('assignment_id', part).neq('status', 'deleted'),
      supabase.from('assignments').select('sample_work_url').in('id', part),
      supabase.from('submissions').select('id').in('assignment_id', part),
    ]);
    if (tracked.error) isMissingTable(tracked.error);
    for (const row of tracked.data || []) keys.add(row.key);
    for (const key of keysFromUrls((assignments.data || []).map((a) => a.sample_work_url))) keys.add(key);
    const submissionIds = (submissions.data || []).map((s) => s.id as string);
    for (const subPart of chunks(submissionIds, IN_CHUNK)) {
      const { data } = await supabase.from('submission_answers').select('file_url').in('submission_id', subPart).not('file_url', 'is', null);
      for (const key of keysFromUrls((data || []).map((a) => a.file_url))) keys.add(key);
    }
  }
  return [...keys];
}

/** R2 keys in the answers to these questions (questions removed from an assignment). */
export async function questionFileKeys(supabase: Supabase, questionIds: string[]): Promise<string[]> {
  const keys = new Set<string>();
  for (const part of chunks(questionIds, IN_CHUNK)) {
    const { data } = await supabase.from('submission_answers').select('file_url').in('question_id', part).not('file_url', 'is', null);
    for (const key of keysFromUrls((data || []).map((a) => a.file_url))) keys.add(key);
  }
  return [...keys];
}

/** Marks a user's uploads (by URL) as in use by this assignment. */
export async function attachFiles(supabase: Supabase, urls: Array<string | null | undefined>, assignmentId: string, ownerIds: string[]) {
  const wanted = [...new Set(urls.filter((u): u is string => !!u && !!keyFromPublicUrl(u)))];
  if (!wanted.length || !ownerIds.length) return;
  const { error } = await supabase
    .from(STORED_FILES)
    .update({ status: 'attached', attached_at: new Date().toISOString(), assignment_id: assignmentId })
    .in('url', wanted)
    .in('owner_id', ownerIds)
    .in('status', OPEN_STATUSES);
  if (error && !isMissingTable(error)) console.warn('[storage] attach failed:', error.message);
}

/**
 * After a student hands in: their other uploads for this assignment were
 * replaced or abandoned, so they go. Returns how many objects were removed.
 */
export async function discardDrafts(supabase: Supabase, assignmentId: string, ownerIds: string[], keepUrls: Array<string | null | undefined> = []) {
  if (!ownerIds.length) return 0;
  const { data, error } = await supabase
    .from(STORED_FILES)
    .select('key, url')
    .eq('assignment_id', assignmentId)
    .in('owner_id', ownerIds)
    .in('status', OPEN_STATUSES);
  if (error) {
    if (!isMissingTable(error)) console.warn('[storage] draft lookup failed:', error.message);
    return 0;
  }
  const keep = new Set(keepUrls.filter(Boolean));
  return removeFiles(supabase, (data || []).filter((row) => !keep.has(row.url)).map((row) => row.key));
}

/** Removes uploads that were never handed in within DRAFT_TTL_MS. Returns how many objects were removed. */
export async function sweepExpiredDrafts(supabase: Supabase) {
  const cutoff = new Date(Date.now() - DRAFT_TTL_MS).toISOString();
  const { data, error } = await supabase
    .from(STORED_FILES)
    .select('key')
    .in('status', OPEN_STATUSES)
    .lt('created_at', cutoff)
    .limit(1000);
  if (error) {
    if (!isMissingTable(error)) console.warn('[storage] sweep lookup failed:', error.message);
    return 0;
  }
  return removeFiles(supabase, (data || []).map((row) => row.key));
}

let lastSweepAt = 0;
/** sweepExpiredDrafts at most once an hour per server instance (called after uploads). */
export async function sweepExpiredDraftsOccasionally(supabase: Supabase) {
  if (Date.now() - lastSweepAt < 60 * 60 * 1000) return;
  lastSweepAt = Date.now();
  const removed = await sweepExpiredDrafts(supabase);
  if (removed) console.log(`[storage] removed ${removed} expired draft upload(s)`);
}
