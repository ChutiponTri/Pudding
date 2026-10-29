import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { signalClassroom } from '@/lib/realtime/classroomSignal';
import { assignmentFileKeys, removeFiles } from '@/lib/storage/files';
import { DRAFT_PUBLISH_AT, DRAFT_RETENTION_MS } from '@/lib/utils/assignmentWindow';

/**
 * Deletes assignment/quiz drafts that were never published within
 * DRAFT_RETENTION_DAYS of being created, with their questions and files.
 * Returns how many drafts were removed.
 */
export async function deleteExpiredAssignmentDrafts(supabase: SupabaseClient, now: Date = new Date()) {
  const cutoff = new Date(now.getTime() - DRAFT_RETENTION_MS).toISOString();
  const { data, error } = await supabase
    .from('assignments')
    .select('id, classroom_id')
    .gte('publish_at', DRAFT_PUBLISH_AT)
    .lt('created_at', cutoff)
    .limit(200);
  if (error) {
    // Databases without publish_at have no drafts.
    if (!error.message?.includes('publish_at')) console.warn('[drafts] expired draft lookup failed:', error.message);
    return 0;
  }
  const drafts = (data || []) as Array<{ id: string; classroom_id: string }>;
  if (!drafts.length) return 0;

  const ids = drafts.map((draft) => draft.id);
  const fileKeys = await assignmentFileKeys(supabase, ids);
  await Promise.all([
    supabase.from('questions').delete().in('assignment_id', ids),
    supabase.from('submissions').delete().in('assignment_id', ids),
    ...ids.map((id) => supabase.from('classroom_posts').delete().contains('metadata', { assignmentId: id })),
  ]);
  const { error: deleteError } = await supabase.from('assignments').delete().in('id', ids);
  if (deleteError) {
    console.warn('[drafts] expired draft delete failed:', deleteError.message);
    return 0;
  }
  await removeFiles(supabase, fileKeys);
  await Promise.all([...new Set(drafts.map((draft) => draft.classroom_id))].map((id) => signalClassroom(id, { type: 'timeline' })));
  return drafts.length;
}

let lastSweepAt = 0;
/** deleteExpiredAssignmentDrafts at most once an hour per server instance (called when teachers load work). */
export async function deleteExpiredAssignmentDraftsOccasionally(supabase: SupabaseClient) {
  if (Date.now() - lastSweepAt < 60 * 60 * 1000) return;
  lastSweepAt = Date.now();
  const removed = await deleteExpiredAssignmentDrafts(supabase);
  if (removed) console.log(`[drafts] removed ${removed} expired assignment draft(s)`);
}
