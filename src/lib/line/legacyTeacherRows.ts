import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Teacher accounts come from Clerk (ids like "user_2abc…"); student accounts
 * come from LINE (ids like "U1234…"). Before teacher_line_uid existed, a
 * teacher who also opened the student LIFF app had their teacher row found by
 * line_uid and rewritten as a student. Those rows flip between teacher (on the
 * dashboard) and student (in LIFF). These helpers recognise and repair them.
 */

export const isClerkUserId = (id: unknown): boolean => typeof id === 'string' && id.startsWith('user_');

type LegacyRow = { id: string; role?: string | null; line_uid?: string | null; teacher_line_uid?: string | null };

/** A Clerk teacher row still holding the student LINE id (or marked student). */
export const needsTeacherRepair = (row: LegacyRow) => isClerkUserId(row.id) && (!!row.line_uid || row.role !== 'teacher');

/**
 * Makes the row a teacher again and moves its LINE id to teacher_line_uid,
 * freeing line_uid (unique) for the person's own student account.
 */
export async function repairTeacherRow(supabase: SupabaseClient, row: LegacyRow) {
  const patch: Record<string, unknown> = { role: 'teacher', line_uid: null, updated_at: new Date().toISOString() };
  if (!row.teacher_line_uid && row.line_uid) patch.teacher_line_uid = row.line_uid;
  let { error } = await supabase.from('users').update(patch).eq('id', row.id);
  // Another teacher row already owns that LINE id: still free line_uid.
  if (error && patch.teacher_line_uid) {
    delete patch.teacher_line_uid;
    ({ error } = await supabase.from('users').update(patch).eq('id', row.id));
  }
  if (error) console.warn('[line] teacher row repair failed:', row.id, error.message);
  else console.log('[line] repaired teacher row that held a student LINE id:', row.id);
}
