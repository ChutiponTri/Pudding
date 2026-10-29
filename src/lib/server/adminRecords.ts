import 'server-only';
import { after } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { signalClassroom } from '@/lib/realtime/classroomSignal';
import { assignmentFileKeys, removeFiles } from '@/lib/storage/files';
import { ADMIN_TABLES, type AdminTable } from '@/lib/server/admin';

type Supabase = ReturnType<typeof createServiceSupabaseClient>;
// Rows of arbitrary tables; columns differ per table.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

export const isAdminTable = (name: unknown): name is AdminTable => (ADMIN_TABLES as readonly string[]).includes(name as string);

/** stored_files is keyed by its R2 object key; every other table by id. */
export const primaryKeyOf = (table: AdminTable) => (table === 'stored_files' ? 'key' : 'id');

/** Login/connection secrets are never shown or written, even by admins. */
export const isSecretColumn = (column: string) => /token|secret|password/i.test(column);

/** Columns an admin may not change: the key and when the row was made. */
export const isReadOnlyColumn = (table: AdminTable, column: string) =>
  column === primaryKeyOf(table) || column === 'created_at' || isSecretColumn(column);

const stripSecrets = (row: Row) => Object.fromEntries(Object.entries(row).filter(([key]) => !isSecretColumn(key)));

/** Text columns the list page searches, per table. */
const SEARCH_COLUMNS: Record<AdminTable, string[]> = {
  users: ['id', 'first_name', 'last_name', 'email', 'student_id', 'line_uid', 'teacher_line_uid', 'institution'],
  courses: ['id', 'code', 'name'],
  classrooms: ['id', 'name', 'course_name', 'subject_code', 'invite_code', 'line_group_name'],
  classroom_students: ['id', 'classroom_id', 'student_id'],
  classroom_posts: ['id', 'classroom_id', 'body'],
  assignments: ['id', 'title', 'classroom_id', 'group_name'],
  questions: ['id', 'assignment_id', 'question_text'],
  submissions: ['id', 'assignment_id', 'student_id'],
  submission_answers: ['id', 'submission_id', 'question_id', 'text_answer'],
  submission_events: ['id', 'submission_id', 'details'],
  attendance_sessions: ['id', 'classroom_id', 'title'],
  attendance_records: ['id', 'session_id', 'classroom_id', 'student_id'],
  stored_files: ['key', 'original_filename', 'owner_id', 'assignment_id'],
  learning_indicators: ['id', 'code', 'title', 'course_id'],
};

/** Columns shown in the list, so wide tables stay readable; the record page shows everything. */
export const LIST_COLUMNS: Record<AdminTable, string[]> = {
  users: ['id', 'role', 'first_name', 'last_name', 'email', 'student_id', 'teacher_line_uid', 'line_bot_friend', 'updated_at'],
  courses: ['id', 'code', 'name', 'academic_year', 'primary_teacher_id', 'created_at'],
  classrooms: ['id', 'name', 'course_name', 'teacher_id', 'student_count', 'line_group_name', 'created_at'],
  classroom_students: ['id', 'classroom_id', 'student_id', 'status', 'joined_at'],
  classroom_posts: ['id', 'classroom_id', 'activity_type', 'body', 'created_at'],
  assignments: ['id', 'title', 'classroom_id', 'is_exam', 'due_date', 'status_override', 'created_at'],
  questions: ['id', 'assignment_id', 'type', 'question_text', 'max_score'],
  submissions: ['id', 'assignment_id', 'student_id', 'status', 'tab_switch_count', 'total_time_away_seconds', 'is_flagged_suspicious', 'submitted_at'],
  submission_answers: ['id', 'submission_id', 'question_id', 'text_answer', 'teacher_score', 'updated_at'],
  submission_events: ['id', 'submission_id', 'event_type', 'away_duration_seconds', 'details', 'created_at'],
  attendance_sessions: ['id', 'classroom_id', 'title', 'status', 'starts_at'],
  attendance_records: ['id', 'session_id', 'student_id', 'status', 'checked_at'],
  stored_files: ['key', 'purpose', 'status', 'original_filename', 'size_bytes', 'created_at'],
  learning_indicators: ['id', 'course_id', 'code', 'title', 'weight'],
};

/** Where a column's value points: the table holding that id. */
export function linkedTable(table: AdminTable, column: string): AdminTable | null {
  if (column === 'classroom_id') return 'classrooms';
  if (column === 'assignment_id') return 'assignments';
  if (column === 'submission_id') return 'submissions';
  if (column === 'question_id') return 'questions';
  if (column === 'session_id') return 'attendance_sessions';
  if (column === 'course_id') return 'courses';
  // users.student_id is the school student number, not a user id.
  if (column === 'student_id') return table === 'users' ? null : 'users';
  if (['teacher_id', 'primary_teacher_id', 'author_id', 'created_by', 'owner_id', 'submitted_by', 'checked_in_by', 'adjusted_by'].includes(column)) return 'users';
  return null;
}

/** Child rows pointing at a record, for links on its page. */
const CHILDREN: Partial<Record<AdminTable, Array<{ table: AdminTable; column: string }>>> = {
  users: [
    { table: 'classrooms', column: 'teacher_id' },
    { table: 'courses', column: 'primary_teacher_id' },
    { table: 'classroom_students', column: 'student_id' },
    { table: 'submissions', column: 'student_id' },
    { table: 'attendance_records', column: 'student_id' },
    { table: 'stored_files', column: 'owner_id' },
  ],
  courses: [
    { table: 'classrooms', column: 'course_id' },
    { table: 'assignments', column: 'course_id' },
    { table: 'learning_indicators', column: 'course_id' },
  ],
  classrooms: [
    { table: 'assignments', column: 'classroom_id' },
    { table: 'classroom_students', column: 'classroom_id' },
    { table: 'classroom_posts', column: 'classroom_id' },
    { table: 'attendance_sessions', column: 'classroom_id' },
    { table: 'attendance_records', column: 'classroom_id' },
  ],
  assignments: [
    { table: 'questions', column: 'assignment_id' },
    { table: 'submissions', column: 'assignment_id' },
    { table: 'stored_files', column: 'assignment_id' },
  ],
  questions: [{ table: 'submission_answers', column: 'question_id' }],
  submissions: [
    { table: 'submission_answers', column: 'submission_id' },
    { table: 'submission_events', column: 'submission_id' },
  ],
  attendance_sessions: [{ table: 'attendance_records', column: 'session_id' }],
};

const COLUMN_NAME = /^[a-z_][a-z0-9_]*$/;
/** Characters that would break a PostgREST or() filter. */
const cleanSearch = (q: string) => q.replace(/[,()*\\%]/g, ' ').trim().slice(0, 100);

export interface ListOptions {
  q?: string;
  /** Exact match on one column, e.g. the classroom's assignments. */
  filter?: { column: string; value: string };
  page?: number;
  pageSize?: number;
}

export async function listRecords(supabase: Supabase, table: AdminTable, options: ListOptions = {}) {
  const pageSize = options.pageSize || 50;
  const page = Math.max(1, options.page || 1);
  let query = supabase.from(table).select('*', { count: 'exact' });
  const q = cleanSearch(options.q || '');
  if (q) query = query.or(SEARCH_COLUMNS[table].map((column) => `${column}.ilike.*${q}*`).join(','));
  if (options.filter && COLUMN_NAME.test(options.filter.column) && !isSecretColumn(options.filter.column)) {
    query = query.eq(options.filter.column, options.filter.value);
  }
  const { data, count, error } = await query
    .order('created_at', { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw new Error(`${table}: ${error.message}`);
  return { rows: ((data || []) as Row[]).map(stripSecrets), total: count ?? 0, page, pageSize };
}

export async function getRecord(supabase: Supabase, table: AdminTable, id: string): Promise<Row | null> {
  const { data, error } = await supabase.from(table).select('*').eq(primaryKeyOf(table), id).maybeSingle();
  if (error) throw new Error(`${table}: ${error.message}`);
  return data ? stripSecrets(data as Row) : null;
}

/** How many child rows point at the record, per child table. */
export async function relatedCounts(supabase: Supabase, table: AdminTable, id: string) {
  return Promise.all(
    (CHILDREN[table] || []).map(async (child) => {
      const { count } = await supabase.from(child.table).select('*', { count: 'exact', head: true }).eq(child.column, id);
      return { ...child, count: count ?? 0 };
    })
  );
}

/** Applies an admin's edit. Only real, writable columns of the row are changed. */
export async function updateRecord(supabase: Supabase, table: AdminTable, id: string, changes: Row) {
  const current = await getRecord(supabase, table, id);
  if (!current) return null;
  const patch: Row = {};
  for (const [column, value] of Object.entries(changes || {})) {
    if (!(column in current) || isReadOnlyColumn(table, column)) continue;
    patch[column] = value;
  }
  if (!Object.keys(patch).length) return current;
  if ('updated_at' in current && !('updated_at' in patch)) patch.updated_at = new Date().toISOString();
  const { data, error } = await supabase.from(table).update(patch).eq(primaryKeyOf(table), id).select('*').maybeSingle();
  if (error) throw new Error(error.message);
  const classroomId = table === 'classrooms' ? id : (data as Row | null)?.classroom_id;
  // Open teacher and student pages pick the change up.
  if (classroomId) after(() => signalClassroom(classroomId, { type: 'timeline' }));
  return data ? stripSecrets(data as Row) : null;
}

/**
 * Deletes a record the way the app would: assignments and classrooms take
 * their students' files out of storage with them (rows below them go by the
 * database's cascades).
 */
export async function deleteRecord(supabase: Supabase, table: AdminTable, id: string) {
  const current = await getRecord(supabase, table, id);
  if (!current) return false;
  let fileKeys: string[] = [];
  if (table === 'assignments') {
    fileKeys = await assignmentFileKeys(supabase, [id]);
    await Promise.all([
      supabase.from('questions').delete().eq('assignment_id', id),
      supabase.from('submissions').delete().eq('assignment_id', id),
      supabase.from('classroom_posts').delete().contains('metadata', { assignmentId: id }),
    ]);
  } else if (table === 'classrooms') {
    const { data: assignments } = await supabase.from('assignments').select('id').eq('classroom_id', id);
    fileKeys = await assignmentFileKeys(supabase, (assignments || []).map((a) => a.id as string));
  }
  const { error } = await supabase.from(table).delete().eq(primaryKeyOf(table), id);
  if (error) throw new Error(error.message);
  if (fileKeys.length) after(() => removeFiles(supabase, fileKeys));
  const classroomId = table === 'classrooms' ? null : current.classroom_id;
  if (classroomId) after(() => signalClassroom(classroomId, { type: 'timeline' }));
  return true;
}
