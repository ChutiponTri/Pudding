import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from '@/lib/server/access';
import { removeFiles } from '@/lib/storage/files';
import { syncRetakeScores } from '@/lib/server/retake';
import type { Assignment, Classroom, TrashItem, TrashKind } from '@/types/database';

/**
 * ถังขยะ (trash, table trash_items — see supabase_trash_update.sql).
 *
 * Deleting a classroom or a work first copies every row that goes with it into
 * one trash row (payload = { table: rows[] }), then deletes them as before, so
 * the rest of the app never has to skip "deleted" rows. Uploaded files stay in
 * R2 until the item expires (TRASH_DAYS) or is deleted for good. Restoring
 * inserts the rows back with their original ids.
 *
 * Every teacher of the classroom (owner, TA, …) at the time of deleting is kept
 * in teacher_ids: they all see the item and can restore it. Only the teacher
 * who deleted it (owner_id) can delete it for good.
 */

type Supabase = SupabaseClient;

export const TRASH_DAYS = 7;
const TRASH_MS = TRASH_DAYS * 24 * 60 * 60 * 1000;
export const TRASH_TABLE = 'trash_items';
export const TRASH_MIGRATION_MESSAGE = 'ฐานข้อมูลยังไม่รองรับถังขยะ กรุณารัน SQL ใน supabase_trash_update.sql ก่อน';

type Payload = Record<string, Record<string, unknown>[]>;

/** Insert order on restore: parents before the rows that point at them. */
const RESTORE_ORDER = [
  'classrooms',
  'classroom_students',
  'attendance_sessions',
  'attendance_records',
  'classroom_posts',
  'assignments',
  'questions',
  'submissions',
  'submission_answers',
  'submission_events',
  'quiz_attempts',
  'work_groups',
  'work_group_members',
] as const;

const IN_CHUNK = 100;
const PAGE = 1000;
const INSERT_CHUNK = 500;

const chunk = <T>(items: T[], size: number): T[][] => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size));

/** Older trash table without teacher_ids (supabase_trash_update.sql not re-run). */
const isMissingTeacherIds = (error: { code?: string; message?: string } | null | undefined) =>
  !!error && (error.code === '42703' || error.code === 'PGRST204') && !!error.message?.includes('teacher_ids');

/** Everyone who teaches the classroom: its owner and every co-teacher (TA, researcher). */
export function classroomTeacherIds(classroom: { teacher_id?: string | null; teachers?: Array<{ teacher_id?: string }> | null }): string[] {
  return [...new Set([classroom.teacher_id, ...(classroom.teachers || []).map((t) => t.teacher_id)].filter((v): v is string => !!v))];
}

const isMissingTrashTable = (error: { code?: string; message?: string } | null | undefined) =>
  !!error && (error.code === '42P01' || error.code === 'PGRST205' || !!error.message?.includes(TRASH_TABLE));

/** Every row of `table` whose `column` is one of `values` (past PostgREST's 1000-row limit). */
async function selectAll(supabase: Supabase, table: string, column: string, values: string[]) {
  const rows: Record<string, unknown>[] = [];
  for (const part of chunk([...new Set(values)], IN_CHUNK)) {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase.from(table).select('*').in(column, part).range(from, from + PAGE - 1);
      if (error) {
        // Optional tables (older databases) are simply not part of the copy.
        if (error.code === '42P01' || error.code === 'PGRST205') return rows;
        throw new HttpError(500, `บันทึกสำเนาก่อนลบไม่สำเร็จ (${table}): ${error.message}`);
      }
      rows.push(...((data || []) as Record<string, unknown>[]));
      if (!data || data.length < PAGE) break;
    }
  }
  return rows;
}

const ids = (rows: Record<string, unknown>[]) => rows.map((r) => String(r.id));

/** The rows that belong to these assignments (not the assignments themselves). */
async function assignmentChildren(supabase: Supabase, assignmentIds: string[]): Promise<Payload> {
  if (!assignmentIds.length) return {};
  const [questions, submissions, quizAttempts, workGroups, workGroupMembers] = await Promise.all([
    selectAll(supabase, 'questions', 'assignment_id', assignmentIds),
    selectAll(supabase, 'submissions', 'assignment_id', assignmentIds),
    selectAll(supabase, 'quiz_attempts', 'assignment_id', assignmentIds),
    selectAll(supabase, 'work_groups', 'assignment_id', assignmentIds),
    selectAll(supabase, 'work_group_members', 'assignment_id', assignmentIds),
  ]);
  const submissionIds = ids(submissions);
  const [answers, events] = await Promise.all([
    selectAll(supabase, 'submission_answers', 'submission_id', submissionIds),
    selectAll(supabase, 'submission_events', 'submission_id', submissionIds),
  ]);
  return {
    questions,
    submissions,
    submission_answers: answers,
    submission_events: events,
    quiz_attempts: quizAttempts,
    // งานกลุ่ม (empty / skipped on databases without the tables).
    work_groups: workGroups,
    work_group_members: workGroupMembers,
  };
}

/** A work as it is now, with everything that is deleted along with it. */
export async function snapshotAssignment(supabase: Supabase, assignment: Assignment): Promise<Payload> {
  const [children, posts] = await Promise.all([
    assignmentChildren(supabase, [assignment.id]),
    supabase.from('classroom_posts').select('*').contains('metadata', { assignmentId: assignment.id }),
  ]);
  return { assignments: [assignment as unknown as Record<string, unknown>], ...children, classroom_posts: (posts.data || []) as Record<string, unknown>[] };
}

/** A classroom as it is now, with its roster, posts, attendance and all its work. */
export async function snapshotClassroom(supabase: Supabase, classroom: Classroom): Promise<Payload> {
  const id = [classroom.id];
  const [students, posts, sessions, records, assignments] = await Promise.all([
    selectAll(supabase, 'classroom_students', 'classroom_id', id),
    selectAll(supabase, 'classroom_posts', 'classroom_id', id),
    selectAll(supabase, 'attendance_sessions', 'classroom_id', id),
    selectAll(supabase, 'attendance_records', 'classroom_id', id),
    selectAll(supabase, 'assignments', 'classroom_id', id),
  ]);
  return {
    classrooms: [classroom as unknown as Record<string, unknown>],
    classroom_students: students,
    classroom_posts: posts,
    attendance_sessions: sessions,
    attendance_records: records,
    assignments,
    ...(await assignmentChildren(supabase, ids(assignments))),
  };
}

/** Saves the copy; call before deleting the rows. Throws (nothing deleted) when the trash cannot take it. */
export async function putInTrash(
  supabase: Supabase,
  item: {
    kind: TrashKind;
    itemId: string;
    ownerId: string;
    /** Teachers of the classroom; they can see and restore it too. */
    teacherIds: string[];
    title: string;
    subtitle: string;
    classroomId?: string | null;
    payload: Payload;
    fileKeys: string[];
  }
) {
  const now = Date.now();
  const row = {
    id: `trash-${now}-${Math.random().toString(36).slice(2, 10)}`,
    kind: item.kind,
    item_id: item.itemId,
    owner_id: item.ownerId,
    title: item.title || '',
    subtitle: item.subtitle || '',
    classroom_id: item.classroomId || null,
    payload: item.payload,
    file_keys: item.fileKeys,
    deleted_at: new Date(now).toISOString(),
    expires_at: new Date(now + TRASH_MS).toISOString(),
    teacher_ids: [...new Set([item.ownerId, ...item.teacherIds])],
  };
  let { error } = await supabase.from(TRASH_TABLE).insert(row);
  if (isMissingTeacherIds(error)) {
    // Not migrated yet: only the deleting teacher will see it.
    const { teacher_ids: _skip, ...withoutTeachers } = row;
    void _skip;
    ({ error } = await supabase.from(TRASH_TABLE).insert(withoutTeachers));
  }
  if (error) throw isMissingTrashTable(error) ? new HttpError(503, TRASH_MIGRATION_MESSAGE) : new HttpError(500, `ย้ายไปถังขยะไม่สำเร็จ: ${error.message}`);
}

const LIST_FIELDS = 'id, kind, item_id, owner_id, title, subtitle, classroom_id, deleted_at, expires_at, payload';

/**
 * What the teacher deleted, plus what anyone deleted from a classroom they
 * teach, newest first (expired items are purged first).
 */
export async function listTrash(supabase: Supabase, teacherId: string): Promise<TrashItem[]> {
  await purgeExpiredTrash(supabase);
  const query = (shared: boolean) => {
    const q = supabase.from(TRASH_TABLE).select(LIST_FIELDS);
    return (shared ? q.or(`owner_id.eq.${teacherId},teacher_ids.cs.{"${teacherId}"}`) : q.eq('owner_id', teacherId))
      .order('deleted_at', { ascending: false })
      .limit(200);
  };
  let { data, error } = await query(true);
  if (isMissingTeacherIds(error)) ({ data, error } = await query(false));
  if (error) {
    if (isMissingTrashTable(error)) throw new HttpError(503, TRASH_MIGRATION_MESSAGE);
    throw new HttpError(500, error.message);
  }
  const rows = data || [];
  const otherIds = [...new Set(rows.map((r) => r.owner_id as string).filter((id) => id !== teacherId))];
  const names = new Map<string, string>();
  if (otherIds.length) {
    const { data: users } = await supabase.from('users').select('id, name, first_name, last_name').in('id', otherIds);
    for (const u of users || []) names.set(u.id, u.name || [u.first_name, u.last_name].filter(Boolean).join(' '));
  }
  return rows.map((row) => {
    const payload = (row.payload || {}) as Payload;
    const mine = row.owner_id === teacherId;
    return {
      id: row.id,
      kind: row.kind,
      item_id: row.item_id,
      title: row.title,
      subtitle: row.subtitle,
      classroom_id: row.classroom_id,
      deleted_at: row.deleted_at,
      expires_at: row.expires_at,
      deleted_by_me: mine,
      deleted_by_name: mine ? null : names.get(row.owner_id) || null,
      counts: {
        questions: payload.questions?.length || 0,
        submissions: (payload.submissions || []).filter((s) => s.status === 'submitted' || s.status === 'late').length,
        assignments: payload.assignments?.length || 0,
        students: payload.classroom_students?.length || 0,
      },
    } satisfies TrashItem;
  });
}

/** The item, if the teacher deleted it (or, with `shared`, teaches its classroom). */
async function loadTrashFor(supabase: Supabase, teacherId: string, trashId: string, { shared }: { shared: boolean }) {
  const { data, error } = await supabase.from(TRASH_TABLE).select('*').eq('id', trashId).maybeSingle();
  if (error) throw isMissingTrashTable(error) ? new HttpError(503, TRASH_MIGRATION_MESSAGE) : new HttpError(500, error.message);
  const teacherIds: string[] = Array.isArray(data?.teacher_ids) ? data.teacher_ids : [];
  if (!data) throw new HttpError(404, 'ไม่พบรายการนี้ในถังขยะ');
  if (data.owner_id !== teacherId) {
    if (!shared || !teacherIds.includes(teacherId)) throw new HttpError(404, 'ไม่พบรายการนี้ในถังขยะ');
  }
  return data as { id: string; owner_id: string; kind: TrashKind; item_id: string; classroom_id: string | null; payload: Payload; file_keys: string[] | null };
}

async function insertRows(supabase: Supabase, table: string, rows: Record<string, unknown>[]) {
  for (const part of chunk(rows, INSERT_CHUNK)) {
    const { error } = await supabase.from(table).insert(part);
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

/**
 * Puts a trashed item back with its original ids. `canUseClassroom` says
 * whether the teacher may still add work to that classroom. Returns where it
 * went. On a failure everything inserted so far is removed again.
 */
export async function restoreFromTrash(
  supabase: Supabase,
  teacherId: string,
  trashId: string,
  canUseClassroom: (classroomId: string) => Promise<boolean>
): Promise<{ kind: TrashKind; itemId: string; classroomId: string | null }> {
  const item = await loadTrashFor(supabase, teacherId, trashId, { shared: true });
  const payload: Payload = { ...item.payload };

  if (item.kind === 'assignment') {
    const assignment = payload.assignments?.[0];
    const classroomId = String(assignment?.classroom_id || item.classroom_id || '');
    const { data: room } = await supabase.from('classrooms').select('id').eq('id', classroomId).maybeSingle();
    if (!room) throw new HttpError(409, 'ห้องเรียนของงานนี้ถูกลบไปแล้ว กู้คืนห้องเรียนก่อน');
    if (!(await canUseClassroom(classroomId))) throw new HttpError(403, 'ไม่มีสิทธิ์ในห้องเรียนนี้แล้ว');
    const { data: exists } = await supabase.from('assignments').select('id').eq('id', item.item_id).maybeSingle();
    if (exists) throw new HttpError(409, 'งานนี้มีอยู่แล้ว');
  } else {
    const { data: exists } = await supabase.from('classrooms').select('id').eq('id', item.item_id).maybeSingle();
    if (exists) throw new HttpError(409, 'ห้องเรียนนี้มีอยู่แล้ว');
    const room = { ...(payload.classrooms?.[0] || {}) };
    // Whatever was taken over while it sat in the trash is let go.
    if (room.course_id) {
      const { data: course } = await supabase.from('courses').select('id').eq('id', room.course_id).maybeSingle();
      if (!course) room.course_id = null;
    }
    if (room.line_group_id) {
      const { data: other } = await supabase.from('classrooms').select('id').eq('line_group_id', room.line_group_id).maybeSingle();
      if (other) Object.assign(room, { line_group_id: null, line_connection_status: 'disconnected', line_connected_at: null });
    }
    if (room.invite_code) {
      const { data: other } = await supabase.from('classrooms').select('id').eq('invite_code', room.invite_code).maybeSingle();
      if (other) room.invite_code = null;
    }
    payload.classrooms = [room];
  }

  // A retake whose original quiz is gone loses the link (as when the original is deleted).
  const assignmentRows = payload.assignments || [];
  const inPayload = new Set(ids(assignmentRows));
  const outsideOriginals = [...new Set(assignmentRows.map((a) => a.retake_of).filter((v): v is string => typeof v === 'string' && !inPayload.has(v)))];
  const { data: originals } = outsideOriginals.length ? await supabase.from('assignments').select('id').in('id', outsideOriginals) : { data: [] };
  const existing = new Set((originals || []).map((r: { id: string }) => r.id));
  payload.assignments = assignmentRows
    .map((a) => (typeof a.retake_of === 'string' && !inPayload.has(a.retake_of) && !existing.has(a.retake_of) ? { ...a, retake_of: null } : a))
    // Originals before the retakes that point at them.
    .sort((a, b) => Number(!!a.retake_of) - Number(!!b.retake_of));

  try {
    for (const table of RESTORE_ORDER) {
      const rows = payload[table];
      if (rows?.length) await insertRows(supabase, table, rows);
    }
  } catch (error) {
    // Undo: the top row takes its children with it (ON DELETE CASCADE).
    await supabase.from(item.kind === 'assignment' ? 'assignments' : 'classrooms').delete().eq('id', item.item_id);
    throw new HttpError(500, `กู้คืนไม่สำเร็จ: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Retakes write their scores into the original quiz again.
  for (const a of payload.assignments as unknown as Assignment[]) {
    if (a.retake_of) await syncRetakeScores(supabase, a).catch((err) => console.warn('[trash] retake resync failed:', err));
  }
  await supabase.from(TRASH_TABLE).delete().eq('id', item.id);
  const classroomId = item.kind === 'classroom' ? item.item_id : String(payload.assignments?.[0]?.classroom_id || item.classroom_id || '');
  return { kind: item.kind, itemId: item.item_id, classroomId: classroomId || null };
}

/** Deletes a trashed item for good, with its files (only the teacher who deleted it). */
export async function deleteFromTrash(supabase: Supabase, teacherId: string, trashId: string) {
  const item = await loadTrashFor(supabase, teacherId, trashId, { shared: true });
  if (item.owner_id !== teacherId) throw new HttpError(403, 'ลบถาวรได้เฉพาะครูที่ลบรายการนี้');
  await removeTrashRows(supabase, [item]);
}

async function removeTrashRows(supabase: Supabase, rows: Array<{ id: string; file_keys: string[] | null }>) {
  if (!rows.length) return;
  const keys = rows.flatMap((r) => (Array.isArray(r.file_keys) ? r.file_keys : []));
  const { error } = await supabase.from(TRASH_TABLE).delete().in('id', rows.map((r) => r.id));
  if (error) throw new HttpError(500, error.message);
  if (keys.length) await removeFiles(supabase, keys);
}

/** Deletes items past expires_at (and their files). */
export async function purgeExpiredTrash(supabase: Supabase) {
  const { data, error } = await supabase.from(TRASH_TABLE).select('id, file_keys').lt('expires_at', new Date().toISOString()).limit(50);
  if (error) {
    if (!isMissingTrashTable(error)) console.warn('[trash] expired lookup failed:', error.message);
    return 0;
  }
  await removeTrashRows(supabase, (data || []) as Array<{ id: string; file_keys: string[] | null }>).catch((err) => console.warn('[trash] purge failed:', err));
  return data?.length || 0;
}

let lastPurgeAt = 0;
/** purgeExpiredTrash at most once an hour per server instance (called when teachers load work). */
export async function purgeExpiredTrashOccasionally(supabase: Supabase) {
  if (Date.now() - lastPurgeAt < 60 * 60 * 1000) return;
  lastPurgeAt = Date.now();
  const removed = await purgeExpiredTrash(supabase);
  if (removed) console.log(`[trash] removed ${removed} expired item(s)`);
}
