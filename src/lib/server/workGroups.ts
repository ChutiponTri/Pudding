import 'server-only';
import type { createServiceSupabaseClient } from '@/lib/supabase/server';
import { HttpError } from '@/lib/server/access';
import { isGroupWork } from '@/lib/utils/groupWork';
import type { WorkGroup } from '@/types/database';

type Supabase = ReturnType<typeof createServiceSupabaseClient>;

/**
 * งานกลุ่ม: homework where students form groups (at most group_size each) and
 * one member hands in for everyone. Each member still has their own
 * submission row: the hand-in, and later the teacher's grades, are copied to
 * every member (syncGroupCopies), so grade book, exports and announcements
 * work per student as usual. Membership lives in work_group_members, whose
 * primary key (assignment, student) keeps a student in one group only.
 */

export const GROUP_MIGRATION_MESSAGE = 'ฐานข้อมูลยังไม่รองรับงานกลุ่ม กรุณารัน SQL ใน supabase_group_work_update.sql ก่อน';
/** Largest group a teacher may allow. */
export const MAX_GROUP_SIZE = 20;

export { isGroupWork };

const isMissingTable = (error: { code?: string; message?: string } | null | undefined) =>
  !!error && (error.code === '42P01' || error.code === 'PGRST205' || /work_group/.test(error.message || ''));

export function groupError(error: { code?: string; message?: string }): Error {
  if (isMissingTable(error)) return new HttpError(503, GROUP_MIGRATION_MESSAGE);
  return new Error(error.message || 'บันทึกกลุ่มไม่สำเร็จ');
}

type GroupRow = Omit<WorkGroup, 'member_ids'> & { work_group_members?: Array<{ student_id: string; joined_at?: string }> | null };

/** Every group of the work with its members (one request), oldest group first. */
export async function loadWorkGroups(supabase: Supabase, assignmentId: string): Promise<WorkGroup[]> {
  const { data, error } = await supabase
    .from('work_groups')
    .select('id, assignment_id, name, created_by, submitted_by, submitted_at, created_at, work_group_members(student_id, joined_at)')
    .eq('assignment_id', assignmentId)
    .order('created_at', { ascending: true });
  if (error) throw groupError(error);
  return ((data || []) as GroupRow[]).map(({ work_group_members: members, ...group }) => ({
    ...group,
    member_ids: [...(members || [])].sort((a, b) => (a.joined_at || '').localeCompare(b.joined_at || '')).map((m) => m.student_id),
  }));
}

/** The group one of these ids (users.id / LINE id) belongs to, with its member ids. */
export async function groupOfStudent(supabase: Supabase, assignmentId: string, keys: string[]): Promise<{ groupId: string; memberIds: string[] } | null> {
  const ids = [...new Set(keys.filter(Boolean))];
  if (!ids.length) return null;
  const { data: own, error } = await supabase
    .from('work_group_members')
    .select('group_id')
    .eq('assignment_id', assignmentId)
    .in('student_id', ids)
    .limit(1)
    .maybeSingle();
  if (error) throw groupError(error);
  if (!own) return null;
  const { data: members, error: membersError } = await supabase.from('work_group_members').select('student_id').eq('group_id', own.group_id);
  if (membersError) throw groupError(membersError);
  return { groupId: own.group_id, memberIds: (members || []).map((m) => m.student_id) };
}

/** Score fields copied when the teacher grades (the rest of a member's row stays theirs). */
const GRADE_FIELDS = ['total_score', 'max_total_score', 'score_history'] as const;

/**
 * Copies one member's submission to the other members of the group:
 * - 'handin': the whole hand-in (row and answers, replacing what they had),
 *   and the group remembers who handed in;
 * - 'grades': the scores and comments (answers' teacher fields and the total).
 * Members without an account row are skipped (they cannot have a submission).
 */
export async function syncGroupCopies(
  supabase: Supabase,
  assignmentId: string,
  sourceSubmissionId: string,
  mode: 'handin' | 'grades',
  group?: { groupId: string; memberIds: string[] } | null
): Promise<void> {
  const [{ data: source, error: sourceError }, { data: answers, error: answersError }] = await Promise.all([
    supabase.from('submissions').select('*').eq('id', sourceSubmissionId).maybeSingle(),
    supabase.from('submission_answers').select('*').eq('submission_id', sourceSubmissionId),
  ]);
  if (sourceError) throw sourceError;
  if (answersError) throw answersError;
  if (!source) return;
  const found = group ?? (await groupOfStudent(supabase, assignmentId, [source.student_id]));
  if (!found) return;
  const others = found.memberIds.filter((id) => id !== source.student_id);
  if (!others.length) {
    if (mode === 'handin') await markGroupHandIn(supabase, found.groupId, source.student_id, source.submitted_at);
    return;
  }

  // Each member's account and existing row (submissions are unique per assignment + student).
  const quoted = others.map((id) => `"${id.replace(/["\\]/g, '')}"`).join(',');
  const [{ data: users }, { data: existingRows }] = await Promise.all([
    supabase.from('users').select('id, line_uid').or(`id.in.(${quoted}),line_uid.in.(${quoted})`),
    supabase.from('submissions').select('id, student_id').eq('assignment_id', assignmentId).neq('id', sourceSubmissionId),
  ]);
  const userIds = [
    ...new Set(
      others.flatMap((id) => {
        const user = (users || []).find((u) => u.id === id) || (users || []).find((u) => u.line_uid === id);
        return user && user.id !== source.student_id ? [user.id] : [];
      })
    ),
  ];
  const existingOf = new Map((existingRows || []).map((row) => [row.student_id as string, row.id as string]));
  const targets = userIds.map((studentId) => ({ studentId, id: existingOf.get(studentId) || `sub-${assignmentId}-${studentId}` }));
  if (!targets.length) return;

  if (mode === 'handin') {
    const { id: _id, student_id: _student, submitted_by: _by, created_at: _created, ...copy } = source as Record<string, unknown>;
    const rows = targets.map((t) => ({
      ...copy,
      id: t.id,
      student_id: t.studentId,
      // A copy was not sent from anyone's phone; the group row says who handed in.
      ...('submitted_by' in source ? { submitted_by: null } : {}),
      ...('reopened_at' in source ? { reopened_at: null } : {}),
      ...('reopen_until' in source ? { reopen_until: null } : {}),
    }));
    const { error } = await supabase.from('submissions').upsert(rows);
    if (error) throw error;
    const { error: clearError } = await supabase.from('submission_answers').delete().in('submission_id', targets.map((t) => t.id));
    if (clearError) throw clearError;
  } else {
    const patch = Object.fromEntries(GRADE_FIELDS.filter((f) => f in source).map((f) => [f, (source as Record<string, unknown>)[f]]));
    const { error } = await supabase.from('submissions').update(patch).in('id', targets.filter((t) => existingOf.has(t.studentId)).map((t) => t.id));
    if (error) throw error;
  }

  const copies = targets.flatMap((t) =>
    (answers || []).map((answer) => {
      const { id: _id, submission_id: _sub, ...rest } = answer as Record<string, unknown>;
      return { ...rest, id: `ans-${t.id}-${answer.question_id}`, submission_id: t.id };
    })
  );
  if (copies.length) {
    const { error } = await supabase.from('submission_answers').upsert(copies, { onConflict: 'submission_id,question_id' });
    if (error) throw error;
  }
  if (mode === 'handin') await markGroupHandIn(supabase, found.groupId, source.student_id, source.submitted_at);
}

async function markGroupHandIn(supabase: Supabase, groupId: string, by: string, at?: string | null) {
  const { error } = await supabase.from('work_groups').update({ submitted_by: by, submitted_at: at || new Date().toISOString() }).eq('id', groupId);
  if (error) console.warn('[workGroups] could not record who handed in:', error.message);
}
