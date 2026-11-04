import 'server-only';
import { after } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { forgetStudentActor, type Actor } from '@/lib/auth/actor';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { signalClassroom } from '@/lib/realtime/classroomSignal';
import type { ClassroomSignal } from '@/lib/realtime/signals';
import { assignmentPostBody, createClassroomPost } from '@/lib/server/classroomPosts';
import { newClassroomInviteCode, normalizeInviteCode, teacherInviteCode } from '@/lib/server/inviteCodes';
import { isClerkUserId, needsTeacherRepair, repairTeacherRow } from '@/lib/line/legacyTeacherRows';
import { THAI_INSTITUTIONS, canonicalInstitution, sameInstitution } from '@/lib/data/thaiInstitutions';
import { pushTeacherProfileToClerk, readClerkTeacherProfile } from '@/lib/server/clerkTeacherProfile';
import { TEACHER_NAME_PLACEHOLDER, isTeacherProfileComplete, teacherAccessOf } from '@/lib/utils/teacherProfile';
import { rememberTeacherAccess } from '@/lib/server/teacherProfileGuard';
import { notifyAdminNewTeacher } from '@/lib/server/adminNotify';
import { assignmentFileKeys, attachFiles, attachmentKeysInUse, keysFromUrls, questionFileKeys, removeFiles } from '@/lib/storage/files';
import { assignmentAttachmentUrls, cleanAttachments } from '@/lib/utils/referenceWork';
import {
  classroomForStudent,
  classroomRole,
  FORBIDDEN,
  HttpError,
  isTeacherOf,
  loadClassroom,
  questionsForStudent,
  requireStudent,
  requireTeacher,
  requireTeacherOfAssignment,
  requireTeacherOfClassroom,
  UNAUTHORIZED,
} from '@/lib/server/access';
import { parseAcademicPeriod } from '@/lib/utils/academicYear';
import { DRAFT_RETENTION_MS, canRecordNoSubmission, getAssignmentWindow, isAssignmentDraft, isAssignmentPublished } from '@/lib/utils/assignmentWindow';
import { isHandedIn } from '@/lib/utils/gradingStatus';
import { deleteExpiredAssignmentDraftsOccasionally } from '@/lib/server/assignmentDrafts';
import { clearRetiredAutoScores, recomputeSubmissionTotals, regradeObjectiveQuestions, zeroFillNoSubmissions } from '@/lib/server/grading';
import { isObjectiveQuestion } from '@/lib/utils/autoGrade';
import { personNameError, studentProfileError } from '@/lib/utils/studentName';
import type {
  Assignment,
  Classroom,
  Course,
  CourseLearningIndicator,
  LearningIndicator,
  Question,
  Submission,
  SubmissionAnswer,
  SubmissionEvent,
  TeacherGradeRecord,
  TeacherRole,
  User,
} from '@/types/database';

/**
 * Every database read and write the browser needs, run on the server with the
 * service key after checking who is asking (see lib/auth/actor.ts). The
 * browser's dataService calls these through POST /api/data, so pages keep the
 * same API while the database itself is closed to the public key.
 */

type Supabase = SupabaseClient;
type Ctx = { supabase: Supabase; actor: Actor | null };

/** Columns the UI needs from users; avoids shipping whole rows. */
const USER_FIELDS = 'id, first_name, last_name, student_id, institution, avatar_url, email, line_uid, role, is_line_connected';
/** PostgREST `in.(…)` lists live in the URL, so keep each request reasonably small. */
const IN_CHUNK = 150;
/** Assignment columns added by later migrations; dropped from writes when the database lacks them. */
const OPTIONAL_ASSIGNMENT_COLUMNS = ['group_name', 'reminder_offsets_minutes', 'publish_at', 'attachments'] as const;
const ATTACHMENTS_MIGRATION_MESSAGE =
  'ฐานข้อมูลยังไม่รองรับการแนบหลายไฟล์ (ยังไม่มีคอลัมน์ attachments) กรุณารัน SQL ใน supabase_schema_update.sql ก่อน หรือแนบเพียง 1 รายการ';

/**
 * Attachments are checked here (kinds, URLs, at most 3) and mirrored into
 * sample_work_url / sample_work_title, so older code and databases without
 * the attachments column still see the first one. Homework and quizzes both
 * may carry them (students still cannot upload files in a quiz).
 */
function withCleanAttachments<T extends Partial<Assignment>>(data: T): T {
  if (data.attachments === undefined) return data;
  const attachments = cleanAttachments(data.attachments);
  return {
    ...data,
    attachments,
    sample_work_url: attachments[0]?.url || '',
    sample_work_title: attachments[0]?.name || '',
    sample_work_description: '',
  };
}

/** A database without the attachments column keeps only the mirrored first one; refuse rather than drop the rest. */
function assertAttachmentsFit(row: Partial<Assignment>) {
  if ((row.attachments?.length || 0) > 1) throw new Error(ATTACHMENTS_MIGRATION_MESSAGE);
}
const PUBLISH_AT_MIGRATION_MESSAGE =
  'ฐานข้อมูลยังไม่รองรับการตั้งเวลาเผยแพร่ (ยังไม่มีคอลัมน์ publish_at) กรุณารัน SQL ใน supabase_schema_update.sql ก่อน หรือเลือก "เผยแพร่ทันที"';

let registeredInstitutionsCache: { value: string[]; expiresAt: number } | null = null;

function chunk<T>(items: T[], size = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Quote a value for a PostgREST `in.(…)` / `or=(…)` filter. */
function pgValue(value: string): string {
  return `"${value.replace(/["\\]/g, '')}"`;
}

/** Value for a JSONB `contains` filter (JSON text; a JS array would become a Postgres array literal). */
function jsonArray(item: Record<string, string>): string {
  return JSON.stringify([item]);
}

/** Strip characters that would break an `or=(…ilike…)` filter. */
function searchTerm(value: string): string {
  return value.replace(/[,()%*\\"]/g, ' ').trim();
}

/** Turns a Supabase error into a readable message; a missing column means a migration has not been run. */
function toDatabaseError(error: { code?: string; message?: string }, table: string): Error {
  const missingColumn = error.message?.match(/'([^']+)' column/)?.[1] || error.message?.match(/column [\w.]*?\.?(\w+) does not exist/)?.[1];
  if (error.code === 'PGRST204' || error.code === '42703' || missingColumn) {
    return new Error(`ฐานข้อมูลยังไม่มีคอลัมน์ ${table}.${missingColumn || '?'} กรุณาให้ผู้ดูแลรัน supabase_schema_update.sql ล่าสุด`);
  }
  return new Error(error.message || `บันทึกข้อมูล ${table} ไม่สำเร็จ`);
}

function uniqueById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((row) => (seen.has(row.id) ? false : (seen.add(row.id), true)));
}

function byCreatedDesc<T extends { created_at?: string }>(a: T, b: T): number {
  return (b.created_at || '').localeCompare(a.created_at || '');
}

/** Load users referenced by id, LINE id or school number, in a few batched requests. */
async function fetchUsersByKeys(supabase: Supabase, keys: Array<string | undefined | null>): Promise<Map<string, User>> {
  const unique = [...new Set(keys.filter((k): k is string => !!k && !!k.trim()))];
  const map = new Map<string, User>();
  if (unique.length === 0) return map;
  const results = await Promise.all(
    chunk(unique).map((part) => {
      const list = part.map(pgValue).join(',');
      return supabase.from('users').select(USER_FIELDS).or(`id.in.(${list}),line_uid.in.(${list}),student_id.in.(${list})`);
    })
  );
  for (const { data } of results) {
    for (const u of (data || []) as User[]) {
      map.set(u.id, u);
      if (u.line_uid) map.set(u.line_uid, u);
      if (u.student_id) map.set(u.student_id, u);
    }
  }
  return map;
}

type EnrollmentLink = { classroom_id: string; student_id: string; status: string };

function mergeStudent(raw: User, db: User | undefined, status: 'active' | 'pending_approval'): User {
  return {
    ...raw,
    id: db?.id || raw.id,
    first_name: db?.first_name || raw.first_name || '',
    last_name: db?.last_name || raw.last_name || '',
    student_id: db?.student_id || raw.student_id,
    institution: db?.institution || raw.institution,
    avatar_url: db?.avatar_url || raw.avatar_url,
    email: db?.email || raw.email,
    line_uid: db?.line_uid || raw.line_uid,
    role: 'student',
    enrollment_status: status,
  };
}

/**
 * Fill in each classroom's roster from the users table. The classroom row keeps
 * a JSON snapshot of students; classroom_students holds relational enrolments.
 */
async function hydrateClassrooms(supabase: Supabase, rows: Classroom[]): Promise<Classroom[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((c) => c.id);
  const linkResults = await Promise.all(
    chunk(ids).map((part) => supabase.from('classroom_students').select('classroom_id, student_id, status').in('classroom_id', part))
  );
  const links = linkResults.flatMap((r) => (r.data || []) as EnrollmentLink[]);

  const keys: string[] = links.map((l) => l.student_id);
  for (const cls of rows) {
    for (const s of [...(cls.students || []), ...(cls.pending_students || [])]) keys.push(s.id, s.line_uid || '', s.student_id || '');
  }
  const users = await fetchUsersByKeys(supabase, keys);
  const lookup = (s: User) => users.get(s.id) || (s.line_uid ? users.get(s.line_uid) : undefined) || (s.student_id ? users.get(s.student_id) : undefined);

  const linksByClass = new Map<string, EnrollmentLink[]>();
  for (const link of links) {
    const list = linksByClass.get(link.classroom_id) || [];
    list.push(link);
    linksByClass.set(link.classroom_id, list);
  }

  return rows.map((cls) => {
    const active: User[] = [];
    const pending: User[] = [];
    const seenActive = new Set<string>();
    const seenPending = new Set<string>();
    for (const s of (cls.students || []) as User[]) {
      const merged = mergeStudent(s, lookup(s), 'active');
      if (!seenActive.has(merged.id)) {
        seenActive.add(merged.id);
        active.push(merged);
      }
    }
    for (const s of (cls.pending_students || []) as User[]) {
      const merged = mergeStudent(s, lookup(s), 'pending_approval');
      if (!seenActive.has(merged.id) && !seenPending.has(merged.id)) {
        seenPending.add(merged.id);
        pending.push(merged);
      }
    }
    for (const link of linksByClass.get(cls.id) || []) {
      const u = users.get(link.student_id);
      if (!u) continue;
      if (link.status === 'pending_approval') {
        if (!seenActive.has(u.id) && !seenPending.has(u.id)) {
          seenPending.add(u.id);
          pending.push({ ...u, enrollment_status: 'pending_approval' });
        }
      } else if (!seenActive.has(u.id)) {
        seenActive.add(u.id);
        const idx = pending.findIndex((p) => p.id === u.id);
        if (idx >= 0) pending.splice(idx, 1);
        active.push({ ...u, enrollment_status: 'active' });
      }
    }
    let semester = cls.semester;
    let yearCe = cls.year_ce;
    if (!semester || !yearCe) {
      const parsed = parseAcademicPeriod(cls.academic_year);
      if (parsed) {
        semester = semester ?? parsed.semester;
        yearCe = yearCe ?? parsed.yearCE;
      }
    }
    return { ...cls, semester, year_ce: yearCe, students: active, pending_students: pending, student_count: active.length };
  });
}

/**
 * hydrateClassrooms for one student's own screen: same rules for the
 * student's own roster entry (active / waiting for approval), without loading
 * every classmate's account, which a student never receives (classroomForStudent
 * keeps only their own entry). `links` are the student's own enrollment rows
 * and `ownUsers` their account(s), both loaded alongside the classrooms.
 */
async function hydrateClassroomsForStudent(
  supabase: Supabase,
  rows: Classroom[],
  keys: string[],
  links: EnrollmentLink[],
  ownUsers: Map<string, User>
): Promise<Classroom[]> {
  const keySet = new Set(keys);
  const ownIds = new Set<string>(keys);
  const ownSchoolNumbers = new Set<string>();
  for (const u of ownUsers.values()) {
    ownIds.add(u.id);
    if (u.line_uid) ownIds.add(u.line_uid);
    if (u.student_id) ownSchoolNumbers.add(u.student_id);
  }
  // A roster entry that only shares the school number is the student's unless its id belongs to someone else.
  const bySchoolNumberOnly = (s: User) =>
    !!s.student_id && ownSchoolNumbers.has(s.student_id) && !ownIds.has(s.id) && !(s.line_uid && ownIds.has(s.line_uid));
  const candidates = rows.flatMap((cls) => [...(cls.students || []), ...(cls.pending_students || [])] as User[]).filter(bySchoolNumberOnly);
  const others = candidates.length ? await fetchUsersByKeys(supabase, candidates.flatMap((s) => [s.id, s.line_uid])) : new Map<string, User>();
  const ownUser = [...ownUsers.values()][0];
  const resolve = (s: User): User | undefined => {
    if (ownIds.has(s.id) || (s.line_uid && ownIds.has(s.line_uid))) return ownUsers.get(s.id) || (s.line_uid ? ownUsers.get(s.line_uid) : undefined) || ownUser;
    if (bySchoolNumberOnly(s)) {
      const other = others.get(s.id) || (s.line_uid ? others.get(s.line_uid) : undefined);
      return other && !ownIds.has(other.id) ? undefined : ownUser;
    }
    return undefined;
  };
  return rows.map((cls) => {
    const active: User[] = [];
    const pending: User[] = [];
    const seen = new Set<string>();
    for (const s of (cls.students || []) as User[]) {
      const db = resolve(s);
      if (!db && !keySet.has(s.id)) continue;
      const merged = mergeStudent(s, db, 'active');
      if (!seen.has(merged.id)) {
        seen.add(merged.id);
        active.push(merged);
      }
    }
    for (const s of (cls.pending_students || []) as User[]) {
      const db = resolve(s);
      if (!db && !keySet.has(s.id)) continue;
      const merged = mergeStudent(s, db, 'pending_approval');
      if (!seen.has(merged.id) && !pending.some((p) => p.id === merged.id)) pending.push(merged);
    }
    for (const link of links.filter((l) => l.classroom_id === cls.id)) {
      const u = ownUsers.get(link.student_id);
      if (!u) continue;
      if (link.status === 'pending_approval') {
        if (!seen.has(u.id) && !pending.some((p) => p.id === u.id)) pending.push({ ...u, enrollment_status: 'pending_approval' });
      } else if (!seen.has(u.id)) {
        seen.add(u.id);
        const idx = pending.findIndex((p) => p.id === u.id);
        if (idx >= 0) pending.splice(idx, 1);
        active.push({ ...u, enrollment_status: 'active' });
      }
    }
    let semester = cls.semester;
    let yearCe = cls.year_ce;
    if (!semester || !yearCe) {
      const parsed = parseAcademicPeriod(cls.academic_year);
      if (parsed) {
        semester = semester ?? parsed.semester;
        yearCe = yearCe ?? parsed.yearCE;
      }
    }
    // Class size from the roster as stored (not shown to students; no classmate lookups).
    return { ...cls, semester, year_ce: yearCe, students: active, pending_students: pending, student_count: (cls.students || []).length };
  });
}

/** Make sure a teacher row exists before inserting rows that reference it. */
async function ensureTeacherUser(
  supabase: Supabase,
  teacherId: string | undefined,
  teachers: Array<{ teacher_id: string; name?: string; email?: string; avatar_url?: string }> | undefined
) {
  if (!teacherId) return;
  const { data: exists } = await supabase.from('users').select('id').eq('id', teacherId).maybeSingle();
  if (exists) return;
  const teacher = teachers?.find((t) => t.teacher_id === teacherId) || teachers?.[0];
  const [first, ...rest] = (teacher?.name || 'คุณครู').trim().split(' ');
  await supabase.from('users').upsert({
    id: teacherId,
    first_name: first || 'คุณครู',
    last_name: rest.join(' '),
    role: 'teacher',
    email: teacher?.email || null,
    avatar_url: teacher?.avatar_url || null,
    updated_at: new Date().toISOString(),
  });
}

/** Classrooms whose JSON roster contains the student (by users.id or LINE id). */
async function findClassroomsContainingStudent(supabase: Supabase, keys: string[]): Promise<Classroom[]> {
  const unique = [...new Set(keys.filter(Boolean))];
  const queries = unique.flatMap((key) => [
    supabase.from('classrooms').select('*').contains('students', jsonArray({ id: key })),
    supabase.from('classrooms').select('*').contains('pending_students', jsonArray({ id: key })),
    supabase.from('classrooms').select('*').contains('students', jsonArray({ line_uid: key })),
    supabase.from('classrooms').select('*').contains('pending_students', jsonArray({ line_uid: key })),
  ]);
  const results = await Promise.all(queries);
  return uniqueById(results.flatMap((r) => (r.data || []) as Classroom[]));
}

/** Teacher's own classroom ids (owner or co-teacher). */
async function teacherClassroomIds(supabase: Supabase, teacherId: string): Promise<Set<string>> {
  const [own, shared] = await Promise.all([
    supabase.from('classrooms').select('id').eq('teacher_id', teacherId),
    supabase.from('classrooms').select('id').contains('teachers', jsonArray({ teacher_id: teacherId })),
  ]);
  return new Set([...(own.data || []), ...(shared.data || [])].map((r: { id: string }) => r.id));
}

/**
 * Assignments of already-authorised classrooms. Teachers see drafts (until the
 * retention sweep removes them); students only published work.
 */
async function loadAssignments(supabase: Supabase, classroomIds: string[], forTeacher: boolean): Promise<Assignment[]> {
  if (classroomIds.length === 0) return [];
  const results = await Promise.all(chunk(classroomIds).map((part) => supabase.from('assignments').select('*').in('classroom_id', part)));
  const failed = results.find((r) => r.error);
  if (failed?.error) throw toDatabaseError(failed.error, 'assignments');
  const list = results.flatMap((r) => (r.data || []) as Assignment[]);
  return forTeacher ? teacherVisibleAssignments(supabase, list) : list.filter((a) => isAssignmentPublished(a)).sort(byCreatedDesc);
}

/** Newest first, without drafts past DRAFT_RETENTION_DAYS (hidden until the sweep deletes them). */
function teacherVisibleAssignments(supabase: Supabase, list: Assignment[]): Assignment[] {
  after(() => deleteExpiredAssignmentDraftsOccasionally(supabase));
  const draftCutoff = Date.now() - DRAFT_RETENTION_MS;
  return list
    .filter((a) => !isAssignmentDraft(a) || !a.created_at || new Date(a.created_at).getTime() >= draftCutoff)
    .sort(byCreatedDesc);
}

/**
 * Classroom columns the sidebar list shows (no rosters, no LINE secrets), plus
 * the parent course's term in the same request.
 */
const CLASSROOM_LIST_FIELDS =
  'id, name, course_id, course_name, subject_code, semester, year_ce, academic_year, student_count, created_at, course:courses(semester, year_ce)';

type ClassroomListRow = Classroom & { course?: { semester?: number | null; year_ce?: number | null } | null };

/**
 * A classroom without its own term takes its course's, as the dashboard's
 * semester filter does, so the sidebar can filter without loading courses.
 */
function withEffectiveTerm({ course, ...cls }: ClassroomListRow): Classroom {
  return {
    ...cls,
    semester: cls.semester ?? course?.semester ?? undefined,
    year_ce: cls.year_ce ?? course?.year_ce ?? undefined,
  } as Classroom;
}

/** Submission columns the dashboard counts from (no answers, no profiles). */
const DASHBOARD_SUBMISSION_FIELDS =
  'id, assignment_id, student_id, status, total_score, max_total_score, is_flagged_suspicious, tab_switch_count, total_time_away_seconds';

/** Classroom ids the student belongs to or asked to join. */
async function studentClassroomIds(supabase: Supabase, actor: Extract<Actor, { kind: 'student' }>): Promise<Set<string>> {
  const [fromRoster, links] = await Promise.all([
    findClassroomsContainingStudent(supabase, actor.keys),
    supabase.from('classroom_students').select('classroom_id').in('student_id', actor.keys),
  ]);
  return new Set([...fromRoster.map((c) => c.id), ...(links.data || []).map((l: { classroom_id: string }) => l.classroom_id)]);
}

/** Shapes a hydrated classroom for the caller: full for its teachers, trimmed for students. */
function forCaller(actor: Actor | null, classroom: Classroom): Classroom {
  return actor?.kind === 'student' ? classroomForStudent(classroom, actor) : classroom;
}

const signalRoster = (classroomId: string, detail: Omit<Extract<ClassroomSignal, { type: 'roster' }>, 'type'>) =>
  after(() => signalClassroom(classroomId, { type: 'roster', ...detail }));

const isSelf = (actor: Extract<Actor, { kind: 'student' }>, id?: string | null) => !!id && actor.keys.includes(id);

// ==============================================================================
// ACTIONS (name → handler). Arguments mirror the browser dataService methods.
// ==============================================================================
export const dataActions = {
  // ---------- USERS ----------
  async syncLineStudentUser({ supabase, actor }: Ctx, student: { name: string; first_name?: string; last_name?: string; avatar?: string | null; student_id?: string; institution?: string; email?: string | null }) {
    const me = requireStudent(actor);
    const lineUid = me.lineUid;
    // A new student's name stays blank until they type their real one; the
    // LINE display name is often a nickname, so it is never used as the name.
    let firstName = student.first_name?.trim() || '';
    let lastName = student.last_name?.trim() || '';
    let studentCode: string | null = student.student_id?.trim() || null;
    let institution: string | null = canonicalInstitution(student.institution) || null;
    // LINE userId is the stable identity; reuse an older row found by line_uid.
    const { data: existingRows, error: readError } = await supabase
      .from('users')
      .select('*')
      .or(`id.eq.${pgValue(lineUid)},line_uid.eq.${pgValue(lineUid)}`)
      .limit(2);
    if (readError) throw toDatabaseError(readError, 'users');
    // A teacher account holding this LINE id (from before teacher_line_uid) is repaired, never reused as the student.
    for (const row of existingRows || []) if (needsTeacherRepair(row)) await repairTeacherRow(supabase, row);
    const studentRows = (existingRows || []).filter((u) => !isClerkUserId(u.id));
    const existing = studentRows.find((u) => u.id === lineUid) || studentRows[0];
    if (existing) {
      if (existing.first_name && !student.first_name) firstName = existing.first_name;
      if (existing.last_name && !student.last_name) lastName = existing.last_name;
      if (existing.student_id && !student.student_id) studentCode = existing.student_id;
      if (existing.institution && !student.institution) institution = existing.institution;
    }
    const payload: Record<string, unknown> = {
      id: existing?.id || lineUid,
      first_name: firstName,
      last_name: lastName,
      avatar_url: student.avatar || null,
      role: 'student',
      line_uid: lineUid,
      is_line_connected: true,
      updated_at: new Date().toISOString(),
    };
    const email = student.email?.trim() || (typeof existing?.email === 'string' ? existing.email.trim() : '');
    if (email) payload.email = email;
    if (studentCode) payload.student_id = studentCode;
    if (institution) payload.institution = institution;
    const { error } = await supabase.from('users').upsert(payload);
    if (error) throw toDatabaseError(error, 'users');
    forgetStudentActor(lineUid);
    return {
      id: payload.id as string,
      first_name: firstName,
      last_name: lastName,
      student_id: studentCode || undefined,
      institution: institution || undefined,
      avatar_url: (payload.avatar_url as string) || undefined,
      email: (payload.email as string) || undefined,
      role: 'student',
      line_uid: lineUid,
      is_line_connected: true,
    } as User;
  },

  async updateStudentProfile({ supabase, actor }: Ctx, userId: string, data: { first_name: string; last_name: string; student_id: string; institution: string; email?: string | null }) {
    const me = requireStudent(actor);
    if (!isSelf(me, userId)) throw FORBIDDEN();
    const fields = {
      first_name: data.first_name.trim(),
      last_name: data.last_name.trim(),
      student_id: data.student_id.trim(),
      institution: canonicalInstitution(data.institution),
      email: data.email?.trim() || null,
    };
    const nameError = personNameError(fields.first_name, fields.last_name);
    if (nameError) throw new HttpError(400, nameError);
    const { error } = await supabase.from('users').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', me.userId);
    if (error) {
      console.error('updateStudentProfile error:', error);
      return false;
    }
    // Keep the roster snapshots of the student's classrooms in step.
    const classrooms = await findClassroomsContainingStudent(supabase, me.keys);
    const patch = (s: User) => (isSelf(me, s.id) || isSelf(me, s.line_uid) ? { ...s, ...fields, email: fields.email || undefined } : s);
    await Promise.all(
      classrooms.map((cls) =>
        supabase
          .from('classrooms')
          .update({ students: (cls.students || []).map(patch), pending_students: (cls.pending_students || []).map(patch) })
          .eq('id', cls.id)
      )
    );
    for (const cls of classrooms) signalRoster(cls.id, { action: 'updated' });
    registeredInstitutionsCache = null;
    return true;
  },

  async updateTeacherProfile({ supabase, actor }: Ctx, userId: string, profile: { first_name: string; last_name: string; institution: string }) {
    const me = requireTeacher(actor);
    if (userId !== me.userId) throw FORBIDDEN();
    const fn = profile.first_name.trim();
    const ln = profile.last_name.trim();
    const inst = canonicalInstitution(profile.institution);
    if (!isTeacherProfileComplete({ first_name: fn, last_name: ln, institution: inst })) return false;
    const { data: before } = await supabase.from('users').select('first_name, last_name, institution, email, teacher_approval').eq('id', me.userId).maybeSingle();
    const { error } = await supabase.from('users').update({ first_name: fn, last_name: ln, institution: inst, updated_at: new Date().toISOString() }).eq('id', me.userId);
    if (error) throw toDatabaseError(error, 'users');
    const access = teacherAccessOf({ first_name: fn, last_name: ln, institution: inst, teacher_approval: before?.teacher_approval });
    rememberTeacherAccess(me.userId, access);
    registeredInstitutionsCache = null;
    // A new teacher just finished signing up: ask the admin to review them (once,
    // when the profile first becomes complete, so the email has a name and school).
    if (access === 'pending' && !isTeacherProfileComplete(before)) {
      after(() => notifyAdminNewTeacher({ id: me.userId, first_name: fn, last_name: ln, institution: inst!, email: before?.email }));
    }
    // Mirror to Clerk so the Clerk dashboard shows the same name and institution.
    await pushTeacherProfileToClerk(me.userId, { first_name: fn, last_name: ln, institution: inst! });
    return true;
  },

  /**
   * Creates/refreshes the teacher's users row on sign-in and returns it.
   * Clerk sync: once a profile has been saved in Pudding, Clerk holds the
   * source copy (firstName, lastName, publicMetadata.institution), so edits
   * made in the Clerk dashboard flow back here. Older accounts whose profile
   * predates that are pushed to Clerk once instead.
   */
  async syncClerkUser({ supabase, actor }: Ctx, clerkUser: { firstName?: string | null; lastName?: string | null; imageUrl?: string | null; email?: string | null; institution?: string | null }) {
    const me = requireTeacher(actor);
    const [{ data: existing }, clerkProfile] = await Promise.all([
      supabase.from('users').select('id, role, first_name, last_name, institution, line_uid, teacher_line_uid').eq('id', me.userId).maybeSingle(),
      readClerkTeacherProfile(me.userId),
    ]);
    // Frees a student LINE id left on this teacher row from before teacher_line_uid existed.
    if (existing && needsTeacherRepair(existing)) await repairTeacherRow(supabase, existing);
    const fromClerk = clerkProfile?.synced ? clerkProfile : null;
    const stored = (value: string | null | undefined) => {
      const text = value?.trim() || '';
      return text === TEACHER_NAME_PLACEHOLDER ? '' : text;
    };
    /**
     * Once synced, Clerk is the source copy, but a field removed in EITHER
     * place (Clerk dashboard or the users row) counts as missing, so the
     * profile popup comes back. Falling back to the other copy here used to
     * silently restore a deleted name.
     */
    const pick = (field: 'first_name' | 'last_name' | 'institution', fallback: string | null | undefined) => {
      if (fromClerk) return existing && !stored(existing[field]) ? '' : fromClerk[field];
      return stored(existing?.[field]) || clerkProfile?.[field] || fallback?.trim() || '';
    };
    const record: Record<string, unknown> = {
      id: me.userId,
      first_name: pick('first_name', clerkUser.firstName) || TEACHER_NAME_PLACEHOLDER,
      last_name: pick('last_name', clerkUser.lastName),
      avatar_url: clerkProfile?.image_url || clerkUser.imageUrl || null,
      email: clerkProfile?.email || clerkUser.email || '',
      role: 'teacher',
      institution: canonicalInstitution(pick('institution', null)) || null,
      updated_at: new Date().toISOString(),
    };
    let { data, error } = await supabase.from('users').upsert({ ...record, clerk_id: me.userId }).select().single();
    if (error && error.message.includes('clerk_id')) ({ data, error } = await supabase.from('users').upsert(record).select().single());
    if (error) throw toDatabaseError(error, 'users');
    const saved = data as User;
    // Requests on this instance see the new state at once (other instances within the guard's 60 s).
    const access = teacherAccessOf(saved);
    rememberTeacherAccess(me.userId, access);
    // Rare: the profile became complete from Clerk's copy, not the popup. Still a new sign-up to review.
    if (access === 'pending' && !isTeacherProfileComplete(existing)) {
      after(() => notifyAdminNewTeacher({ id: me.userId, first_name: saved.first_name, last_name: saved.last_name || '', institution: saved.institution || '', email: saved.email }));
    }
    // A complete profile Clerk does not have yet (saved before Clerk sync existed): copy it over.
    if (clerkProfile && !clerkProfile.synced && isTeacherProfileComplete(saved)) {
      after(() => pushTeacherProfileToClerk(me.userId, { first_name: saved.first_name, last_name: saved.last_name || '', institution: saved.institution || '' }));
    }
    return saved;
  },

  /** Students read themselves; teachers read themselves, people at their school, and their own students. */
  async getUserById({ supabase, actor }: Ctx, id: string) {
    if (!actor) throw UNAUTHORIZED();
    if (actor.kind === 'student' && !isSelf(actor, id)) throw FORBIDDEN();
    const { data, error } = await supabase.from('users').select(USER_FIELDS).eq('id', id).maybeSingle();
    if (error) {
      console.warn('getUserById error:', error.message);
      return null;
    }
    const user = (data as User) || null;
    if (!user || actor.kind === 'student' || user.id === actor.userId) return user;
    const myInstitution = await teacherInstitution(supabase, actor.userId);
    if (myInstitution && sameInstitution(user.institution, myInstitution)) return user;
    const myStudents = await findClassroomsContainingStudent(supabase, [user.id, user.line_uid || ''].filter(Boolean));
    if (myStudents.some((c) => isTeacherOf(c, actor.userId))) return user;
    throw FORBIDDEN();
  },

  /**
   * Manual "add student" search: only students of the teacher's own school
   * (from their profile, not from the browser). Students who registered with a
   * misspelled school join with the invite link instead; the teacher can fix
   * the school name afterwards.
   */
  async searchStudentsByInstitution({ supabase, actor }: Ctx, query?: string) {
    const me = requireTeacher(actor);
    const institution = await teacherInstitution(supabase, me.userId);
    if (!institution) return [];
    let req = supabase.from('users').select(USER_FIELDS).eq('role', 'student').eq('institution', institution);
    const q = searchTerm(query || '');
    if (q) req = req.or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,student_id.ilike.%${q}%,email.ilike.%${q}%`);
    const { data, error } = await req.order('first_name').limit(50);
    if (error) {
      console.warn('searchStudentsByInstitution error:', error.message);
      return [];
    }
    return (data || []) as User[];
  },

  /** Co-teacher search. Results carry only what the picker shows (no LINE ids). */
  async searchTeachers({ supabase, actor }: Ctx, query?: string, institution?: string) {
    requireTeacher(actor);
    let req = supabase.from('users').select('id, first_name, last_name, institution, avatar_url, email, role').eq('role', 'teacher');
    const q = searchTerm(query || '');
    if (q) {
      // Institutions are stored by Thai name; let an English query match them too.
      const lower = q.toLowerCase();
      const byEnglishName = THAI_INSTITUTIONS.filter((inst) => inst.nameEn.toLowerCase().includes(lower)).map((inst) => `institution.eq.${pgValue(inst.name)}`);
      req = req.or([`first_name.ilike.%${q}%`, `last_name.ilike.%${q}%`, `email.ilike.%${q}%`, `institution.ilike.%${q}%`, ...byEnglishName].join(','));
    }
    const { data, error } = await req.order('first_name').limit(50);
    if (error) {
      console.warn('searchTeachers error:', error.message);
      return [];
    }
    const list = (data || []) as User[];
    if (institution) list.sort((a, b) => Number(sameInstitution(b.institution, institution)) - Number(sameInstitution(a.institution, institution)));
    return list;
  },

  async getRegisteredInstitutions({ supabase, actor }: Ctx) {
    if (!actor) throw UNAUTHORIZED();
    if (registeredInstitutionsCache && registeredInstitutionsCache.expiresAt > Date.now()) return registeredInstitutionsCache.value;
    const { data, error } = await supabase.from('users').select('institution').not('institution', 'is', null).neq('institution', '');
    if (error) {
      console.warn('getRegisteredInstitutions error:', error.message);
      return [];
    }
    const value = [...new Set((data || []).map((d: { institution: string }) => canonicalInstitution(d.institution)).filter(Boolean))];
    registeredInstitutionsCache = { value, expiresAt: Date.now() + 5 * 60 * 1000 };
    return value;
  },

  // ---------- TEACHER DASHBOARD ----------
  /**
   * Everything the teacher dashboard shows, in one request. Independent reads
   * run in parallel and classroom ids come straight from the teacher's own
   * classrooms, so nothing is re-authorised along the way.
   */
  async getTeacherDashboard(ctx: Ctx) {
    const me = requireTeacher(ctx.actor);
    const { supabase } = ctx;
    const [courses, ownCls, sharedCls, indicators, profile] = await Promise.all([
      dataActions.getCourses(ctx),
      supabase.from('classrooms').select('*').eq('teacher_id', me.userId),
      supabase.from('classrooms').select('*').contains('teachers', jsonArray({ teacher_id: me.userId })),
      dataActions.getLearningIndicators(ctx),
      supabase.from('users').select(USER_FIELDS).eq('id', me.userId).maybeSingle(),
    ]);
    if (ownCls.error || sharedCls.error) throw toDatabaseError((ownCls.error || sharedCls.error)!, 'classrooms');
    const rows = uniqueById([...(ownCls.data || []), ...(sharedCls.data || [])] as Classroom[]).sort(byCreatedDesc);

    const loadWork = async () => {
      const assignments = await loadAssignments(supabase, rows.map((c) => c.id), true);
      const results = await Promise.all(
        chunk(assignments.map((a) => a.id)).map((part) =>
          supabase.from('submissions').select(DASHBOARD_SUBMISSION_FIELDS).in('assignment_id', part)
        )
      );
      const failed = results.find((r) => r.error);
      if (failed?.error) throw toDatabaseError(failed.error, 'submissions');
      return { assignments, submissions: results.flatMap((r) => r.data || []) };
    };
    const [classrooms, work] = await Promise.all([hydrateClassrooms(supabase, rows), loadWork()]);
    return { courses, classrooms, indicators, profile: (profile.data as User | null) || null, ...work };
  },

  // ---------- COURSES ----------
  async getCourses({ supabase, actor }: Ctx) {
    const me = requireTeacher(actor);
    const [own, shared] = await Promise.all([
      supabase.from('courses').select('*').eq('primary_teacher_id', me.userId),
      supabase.from('courses').select('*').contains('teachers', jsonArray({ teacher_id: me.userId })),
    ]);
    if (own.error || shared.error) throw toDatabaseError((own.error || shared.error)!, 'courses');
    return uniqueById([...(own.data || []), ...(shared.data || [])] as Course[]).sort(byCreatedDesc);
  },

  async getCourseById({ supabase, actor }: Ctx, id: string) {
    const me = requireTeacher(actor);
    const { data, error } = await supabase.from('courses').select('*').eq('id', id).maybeSingle();
    if (error) throw toDatabaseError(error, 'courses');
    const course = data as Course | null;
    if (!course) return null;
    if (isTeacherOf(course, me.userId)) return course;
    // Teachers of one of the course's classrooms (e.g. a TA added to a section) may read it.
    const { data: rows } = await supabase.from('classrooms').select('id, teacher_id, teachers').eq('course_id', id);
    if ((rows || []).some((c) => isTeacherOf(c, me.userId))) return course;
    throw FORBIDDEN();
  },

  async createCourse({ supabase, actor }: Ctx, data: Omit<Course, 'id' | 'created_at'>) {
    const me = requireTeacher(actor);
    const newCourse: Course = { ...data, primary_teacher_id: me.userId, id: `course-${Date.now()}`, created_at: new Date().toISOString() };
    await ensureTeacherUser(supabase, newCourse.primary_teacher_id, newCourse.teachers);
    const { error } = await supabase.from('courses').insert(newCourse);
    if (error) throw toDatabaseError(error, 'courses');
    return newCourse;
  },

  async updateCourse({ supabase, actor }: Ctx, id: string, data: Partial<Course>) {
    const me = requireTeacher(actor);
    const { data: current } = await supabase.from('courses').select('id, primary_teacher_id, teachers, code, name').eq('id', id).maybeSingle();
    if (!current) throw new HttpError(404, 'ไม่พบรายวิชา');
    if (!isTeacherOf(current, me.userId)) throw FORBIDDEN();
    const { id: _id, primary_teacher_id: _owner, ...patch } = data;
    const { data: updated, error } = await supabase.from('courses').update(patch).eq('id', id).select().maybeSingle();
    if (error) throw toDatabaseError(error, 'courses');
    // Sections copy the course's teachers, name and code; keep them in step in one update.
    const classroomSync: Partial<Classroom> = {};
    if (patch.teachers) classroomSync.teachers = patch.teachers;
    const nextCode = patch.code ?? current.code;
    const nextName = patch.name ?? current.name;
    if (nextCode !== current.code || nextName !== current.name) {
      classroomSync.course_name = nextName;
      classroomSync.subject_code = `${nextCode} ${nextName}`;
    }
    if (Object.keys(classroomSync).length > 0) {
      const { error: clsError } = await supabase.from('classrooms').update(classroomSync).eq('course_id', id);
      if (clsError) console.warn('Sync course to classrooms error:', clsError.message);
    }
    return (updated as Course) || null;
  },

  async deleteCourse({ supabase, actor }: Ctx, id: string) {
    const me = requireTeacher(actor);
    const { data: current } = await supabase.from('courses').select('id, primary_teacher_id, teachers').eq('id', id).maybeSingle();
    if (!current) return;
    // Only the course owner may delete it.
    if (current.primary_teacher_id && current.primary_teacher_id !== me.userId) throw FORBIDDEN();
    const { error } = await supabase.from('courses').delete().eq('id', id);
    if (error) throw toDatabaseError(error, 'courses');
  },

  /** The short co-teacher invite code for one of the teacher's courses. */
  async getTeacherInviteCode({ supabase, actor }: Ctx, courseId: string, role: TeacherRole) {
    const me = requireTeacher(actor);
    const { data: course } = await supabase.from('courses').select('id, primary_teacher_id, teachers').eq('id', courseId).maybeSingle();
    if (!course) throw new HttpError(404, 'ไม่พบรายวิชา');
    if (!isTeacherOf(course, me.userId)) throw FORBIDDEN();
    return teacherInviteCode(courseId, role === 'researcher' ? 'researcher' : 'assistant');
  },

  /** What the co-teacher invite page shows for a code: course name/code, role, and who invited. */
  async getCourseInvite({ supabase, actor }: Ctx, code: string) {
    requireTeacher(actor);
    const invite = await resolveTeacherInvite(supabase, code);
    if (!invite) return null;
    const { data: owner } = invite.course.primary_teacher_id
      ? await supabase.from('users').select('first_name, last_name').eq('id', invite.course.primary_teacher_id).maybeSingle()
      : { data: null };
    const { primary_teacher_id: _owner, teachers: _teachers, ...course } = invite.course;
    return {
      course,
      role: invite.role,
      inviterName: owner ? `${owner.first_name || ''} ${owner.last_name || ''}`.trim() : '',
    };
  },

  /** The signed-in teacher joins the course an invite code points to, with that code's role (never owner). */
  async acceptCourseInvite({ supabase, actor }: Ctx, code: string, profile: { name?: string; email?: string; avatar_url?: string } = {}) {
    const me = requireTeacher(actor);
    const invite = await resolveTeacherInvite(supabase, code);
    if (!invite) throw new HttpError(404, 'ลิงก์คำเชิญไม่ถูกต้อง หรือรายวิชาถูกลบไปแล้ว');
    const course = invite.course;
    if (course.primary_teacher_id === me.userId) return true;
    const teachers = [...((course.teachers || []) as Array<{ teacher_id: string; name?: string; email?: string; avatar_url?: string; role: TeacherRole }>)];
    const index = teachers.findIndex((t) => t.teacher_id === me.userId);
    const entry = {
      teacher_id: me.userId,
      name: profile.name?.trim() || (invite.role === 'researcher' ? 'ครูตรวจวิจัย' : 'ครูผู้ช่วย'),
      email: profile.email,
      avatar_url: profile.avatar_url,
      role: invite.role,
    };
    if (index >= 0) {
      // Rejoining with another invite updates the role, but never demotes the owner entry.
      if (teachers[index].role === 'primary') return true;
      teachers[index] = { ...teachers[index], ...entry };
    } else {
      teachers.push(entry);
    }
    const { error } = await supabase.from('courses').update({ teachers }).eq('id', course.id);
    if (error) throw toDatabaseError(error, 'courses');
    const { error: clsError } = await supabase.from('classrooms').update({ teachers }).eq('course_id', course.id);
    if (clsError) console.warn('Sync teachers to classrooms error:', clsError.message);
    return true;
  },

  async getSavedTeacherIndicators(ctx: Ctx) {
    const courses = await dataActions.getCourses(ctx);
    const seen = new Set<string>();
    const collected: CourseLearningIndicator[] = [];
    for (const course of courses) {
      for (const ind of course.indicators || []) {
        const key = ind.title?.trim().toLowerCase();
        if (key && !seen.has(key)) {
          seen.add(key);
          collected.push(ind);
        }
      }
    }
    return collected;
  },

  // ---------- CLASSROOMS ----------
  async getClassrooms({ supabase, actor }: Ctx, options: { withRoster?: boolean } = {}) {
    const me = requireTeacher(actor);
    const [own, shared] = await Promise.all([
      supabase.from('classrooms').select('*').eq('teacher_id', me.userId),
      supabase.from('classrooms').select('*').contains('teachers', jsonArray({ teacher_id: me.userId })),
    ]);
    if (own.error || shared.error) throw toDatabaseError((own.error || shared.error)!, 'classrooms');
    const rows = uniqueById([...(own.data || []), ...(shared.data || [])] as Classroom[]).sort(byCreatedDesc);
    return options.withRoster === false ? rows : hydrateClassrooms(supabase, rows);
  },

  /** The teacher's classrooms for navigation: a few columns, no roster hydration. */
  async getClassroomList({ supabase, actor }: Ctx) {
    const me = requireTeacher(actor);
    const [own, shared] = await Promise.all([
      supabase.from('classrooms').select(CLASSROOM_LIST_FIELDS).eq('teacher_id', me.userId),
      supabase.from('classrooms').select(CLASSROOM_LIST_FIELDS).contains('teachers', jsonArray({ teacher_id: me.userId })),
    ]);
    if (own.error || shared.error) throw toDatabaseError((own.error || shared.error)!, 'classrooms');
    const rows = [...(own.data || []), ...(shared.data || [])] as unknown as ClassroomListRow[];
    return uniqueById(rows.map(withEffectiveTerm)).sort(byCreatedDesc);
  },

  async getStudentClassrooms({ supabase, actor }: Ctx) {
    const me = requireStudent(actor);
    const [fromRoster, links] = await Promise.all([
      findClassroomsContainingStudent(supabase, me.keys),
      supabase.from('classroom_students').select('classroom_id').in('student_id', me.keys),
    ]);
    const known = new Set(fromRoster.map((c) => c.id));
    const extraIds = [...new Set((links.data || []).map((l: { classroom_id: string }) => l.classroom_id))].filter((id) => !known.has(id));
    let extra: Classroom[] = [];
    if (extraIds.length) {
      const { data } = await supabase.from('classrooms').select('*').in('id', extraIds);
      extra = (data || []) as Classroom[];
    }
    const hydrated = await hydrateClassrooms(supabase, [...fromRoster, ...extra].sort(byCreatedDesc));
    return hydrated.map((c) => classroomForStudent(c, me));
  },

  /** A classroom by invite code: what a student needs to join it, nothing more. */
  async findClassroomByInviteCode({ supabase, actor }: Ctx, code: string) {
    if (!actor) throw UNAUTHORIZED();
    // Exact match (ilike would treat "_" as a wildcard and let codes be guessed).
    const normalized = normalizeInviteCode(code);
    if (!normalized) return null;
    const { data, error } = await supabase.from('classrooms').select('*').eq('invite_code', normalized).limit(1).maybeSingle();
    if (error || !data) return null;
    const [hydrated] = await hydrateClassrooms(supabase, [data as Classroom]);
    if (actor.kind === 'teacher' && !isTeacherOf(hydrated, actor.userId)) return { ...hydrated, students: [], pending_students: [] };
    return forCaller(actor, hydrated);
  },

  async getClassroomRoster({ supabase, actor }: Ctx, classroomId: string) {
    if (!actor) throw UNAUTHORIZED();
    const row = await loadClassroom(supabase, classroomId);
    if (!row) return { classroom: null, students: [], pending_students: [] };
    if (actor.kind === 'teacher' && !isTeacherOf(row, actor.userId)) throw FORBIDDEN();
    // Students open classrooms they belong to; joining a new one needs its invite code.
    if (actor.kind === 'student' && !(await classroomRole(supabase, actor, row))) {
      return { classroom: null, students: [], pending_students: [] };
    }
    const [hydrated] = await hydrateClassrooms(supabase, [row]);
    const classroom = forCaller(actor, hydrated);
    return { classroom, students: classroom.students || [], pending_students: classroom.pending_students || [] };
  },

  async getClassroomById(ctx: Ctx, id: string) {
    return (await dataActions.getClassroomRoster(ctx, id)).classroom;
  },

  async createClassroom({ supabase, actor }: Ctx, data: Omit<Classroom, 'id' | 'created_at' | 'student_count' | 'students'>) {
    const me = requireTeacher(actor);
    if (data.course_id) {
      const { data: course } = await supabase.from('courses').select('id, primary_teacher_id, teachers').eq('id', data.course_id).maybeSingle();
      if (course && !isTeacherOf(course, me.userId)) throw FORBIDDEN();
    }
    const inviteCode = newClassroomInviteCode();
    const newClassroom: Classroom = {
      ...data,
      teacher_id: me.userId,
      id: `class-${Date.now()}`,
      student_count: 0,
      students: [],
      pending_students: [],
      invite_code: inviteCode,
      created_at: new Date().toISOString(),
    };
    await ensureTeacherUser(supabase, newClassroom.teacher_id, newClassroom.teachers);
    const { error } = await supabase.from('classrooms').insert(newClassroom);
    if (error) throw toDatabaseError(error, 'classrooms');
    return newClassroom;
  },

  async updateClassroom({ supabase, actor }: Ctx, id: string, data: Partial<Classroom>) {
    await requireTeacherOfClassroom(supabase, actor, id);
    // The owner and LINE link are not editable from here.
    const { id: _id, teacher_id: _owner, line_group_id: _group, line_connection_token: _token, ...patch } = data;
    const { data: updated, error } = await supabase.from('classrooms').update(patch).eq('id', id).select().maybeSingle();
    if (error) throw toDatabaseError(error, 'classrooms');
    if (patch.students || patch.pending_students) signalRoster(id, { action: 'updated' });
    return (updated as Classroom) || null;
  },

  async deleteClassroom({ supabase, actor }: Ctx, id: string) {
    await requireTeacherOfClassroom(supabase, actor, id);
    // Its assignments (and their submissions) go with it, so their files go from storage too.
    const { data: assignments } = await supabase.from('assignments').select('id').eq('classroom_id', id);
    const fileKeys = await assignmentFileKeys(supabase, (assignments || []).map((a) => a.id as string));
    const { error } = await supabase.from('classrooms').delete().eq('id', id);
    if (error) throw toDatabaseError(error, 'classrooms');
    after(() => removeFiles(supabase, fileKeys));
  },

  /**
   * Teachers add any student to their classroom. A student can only add
   * themselves, and only as a join request (unless already admitted).
   */
  async addStudentToClassroom(
    { supabase, actor }: Ctx,
    classroomId: string,
    studentData: Omit<User, 'id' | 'role'> & { id?: string },
    options: { autoAdmit?: boolean; inviteCode?: string } = {}
  ) {
    if (!actor) throw UNAUTHORIZED();
    const classroom = await loadClassroom(supabase, classroomId);
    if (!classroom) throw new HttpError(404, 'ไม่พบห้องเรียนนี้');
    let autoAdmit = options.autoAdmit ?? true;
    let data = studentData;
    if (actor.kind === 'teacher') {
      if (!isTeacherOf(classroom, actor.userId)) throw FORBIDDEN();
    } else {
      // Self-join: identity comes from LINE, admission from the teacher, and a
      // new join request needs the classroom's invite code (not just its id).
      const role = await classroomRole(supabase, actor, classroom);
      if (!role && (!classroom.invite_code || normalizeInviteCode(options.inviteCode) !== normalizeInviteCode(classroom.invite_code))) {
        throw new HttpError(403, 'รหัสเข้าห้องเรียนไม่ถูกต้อง กรุณาขอลิงก์เชิญจากคุณครู');
      }
      autoAdmit = role === 'student';
      // A join request needs the saved profile to be complete, and the roster
      // uses the saved name / number rather than whatever the client sent.
      const { data: profile } = await supabase
        .from('users')
        .select('first_name, last_name, student_id, institution')
        .eq('id', actor.userId)
        .maybeSingle();
      const profileError = studentProfileError(profile);
      if (profileError && !autoAdmit) throw new HttpError(400, profileError);
      data = { ...studentData, ...(profileError ? {} : profile), id: actor.userId, line_uid: actor.lineUid };
    }

    const studentId = data.id || data.line_uid || (data.student_id ? `std_${data.student_id.trim()}` : `std-${Date.now()}`);
    const newStudent: User = {
      ...data,
      id: studentId,
      role: 'student',
      enrollment_status: autoAdmit ? 'active' : 'pending_approval',
      is_line_connected: Boolean(data.line_uid),
    };

    // A teacher adding an existing student must not overwrite that student's profile.
    const { data: existingUser } = await supabase.from('users').select('id').eq('id', newStudent.id).maybeSingle();
    const userWrite = existingUser && actor.kind === 'teacher'
      ? Promise.resolve({ error: null })
      : supabase.from('users').upsert({
          id: newStudent.id,
          first_name: newStudent.first_name,
          last_name: newStudent.last_name,
          student_id: newStudent.student_id,
          institution: newStudent.institution,
          role: 'student',
          email: newStudent.email,
          avatar_url: newStudent.avatar_url || null,
          line_uid: newStudent.line_uid || null,
          is_line_connected: Boolean(newStudent.line_uid),
          updated_at: new Date().toISOString(),
        });
    const [userResult, linkResult] = await Promise.all([
      userWrite,
      supabase.from('classroom_students').upsert({
        id: `cs_${classroomId}_${newStudent.id}`,
        classroom_id: classroomId,
        student_id: newStudent.id,
        status: autoAdmit ? 'active' : 'pending_approval',
        joined_via: newStudent.line_uid ? 'line_liff' : 'invite_code',
      }),
    ]);
    if (userResult.error) throw toDatabaseError(userResult.error, 'users');
    if (linkResult.error) throw toDatabaseError(linkResult.error, 'classroom_students');

    const sameStudent = (s: User) =>
      s.id === newStudent.id ||
      (!!s.line_uid && s.line_uid === newStudent.line_uid) ||
      (!!s.student_id && !!newStudent.student_id && s.student_id.trim() === newStudent.student_id.trim());
    let students = (classroom.students || []) as User[];
    let pending = (classroom.pending_students || []) as User[];
    if (autoAdmit) {
      students = students.some(sameStudent) ? students.map((s) => (sameStudent(s) ? newStudent : s)) : [newStudent, ...students];
      pending = pending.filter((p) => !sameStudent(p));
    } else if (!students.some(sameStudent)) {
      pending = pending.some(sameStudent) ? pending.map((p) => (sameStudent(p) ? newStudent : p)) : [newStudent, ...pending];
    }
    const { error } = await supabase.from('classrooms').update({ students, pending_students: pending, student_count: students.length }).eq('id', classroomId);
    if (error) throw toDatabaseError(error, 'classrooms');

    signalRoster(classroomId, {
      action: 'joined',
      autoAdmit,
      student: { id: newStudent.id, first_name: newStudent.first_name, last_name: newStudent.last_name },
    });
    return newStudent;
  },

  async admitStudentToClassroom(ctx: Ctx, classroomId: string, studentId: string) {
    const { supabase, actor } = ctx;
    const row = await requireTeacherOfClassroom(supabase, actor, classroomId);
    const [classroom] = await hydrateClassrooms(supabase, [row]);
    const pendingList = classroom.pending_students || [];
    const student = pendingList.find((s) => s.id === studentId || s.line_uid === studentId);
    if (!student) return false;
    const remaining = pendingList.filter((s) => s.id !== studentId && s.line_uid !== studentId);
    const current = classroom.students || [];
    const students = current.some((s) => s.id === student.id || (!!s.line_uid && s.line_uid === student.line_uid))
      ? current
      : [{ ...student, enrollment_status: 'active' as const }, ...current];
    const [linkResult, classResult] = await Promise.all([
      supabase.from('classroom_students').update({ status: 'active' }).match({ classroom_id: classroomId, student_id: student.id }),
      supabase.from('classrooms').update({ students, pending_students: remaining, student_count: students.length }).eq('id', classroomId),
    ]);
    if (classResult.error) throw toDatabaseError(classResult.error, 'classrooms');
    if (linkResult.error) console.warn('admitStudentToClassroom link warning:', linkResult.error.message);
    signalRoster(classroomId, { action: 'admitted', student: { id: student.id, first_name: student.first_name, last_name: student.last_name } });
    return true;
  },

  async rejectStudentFromClassroom({ supabase, actor }: Ctx, classroomId: string, studentId: string) {
    const row = await requireTeacherOfClassroom(supabase, actor, classroomId);
    const remaining = ((row.pending_students || []) as User[]).filter((s) => s.id !== studentId && s.line_uid !== studentId);
    const [linkResult, classResult] = await Promise.all([
      supabase.from('classroom_students').delete().match({ classroom_id: classroomId, student_id: studentId }),
      supabase.from('classrooms').update({ pending_students: remaining }).eq('id', classroomId),
    ]);
    if (classResult.error) throw toDatabaseError(classResult.error, 'classrooms');
    if (linkResult.error) console.warn('rejectStudentFromClassroom link warning:', linkResult.error.message);
    signalRoster(classroomId, { action: 'rejected', student: { id: studentId } });
    return true;
  },

  async removeStudentFromClassroom({ supabase, actor }: Ctx, classroomId: string, studentId: string) {
    const row = await requireTeacherOfClassroom(supabase, actor, classroomId);
    const keep = (s: User) => s.id !== studentId && s.line_uid !== studentId;
    const students = ((row.students || []) as User[]).filter(keep);
    const pending = ((row.pending_students || []) as User[]).filter(keep);
    const [linkResult, classResult] = await Promise.all([
      supabase.from('classroom_students').delete().match({ classroom_id: classroomId, student_id: studentId }),
      supabase.from('classrooms').update({ students, pending_students: pending, student_count: students.length }).eq('id', classroomId),
    ]);
    if (classResult.error) throw toDatabaseError(classResult.error, 'classrooms');
    if (linkResult.error) console.warn('removeStudentFromClassroom link warning:', linkResult.error.message);
    signalRoster(classroomId, { action: 'removed', student: { id: studentId } });
  },

  /** Cheap change detector for the roster fallback poll (ids only, no profiles). */
  async rosterFingerprint({ supabase, actor }: Ctx, classroomIds: string[]) {
    if (!actor) throw UNAUTHORIZED();
    const allowed = actor.kind === 'teacher' ? await teacherClassroomIds(supabase, actor.userId) : await studentClassroomIds(supabase, actor);
    const ids = [...new Set(classroomIds)].filter((id) => allowed.has(id));
    if (!ids.length) return '';
    const [cls, links] = await Promise.all([
      supabase.from('classrooms').select('id, students, pending_students').in('id', ids),
      supabase.from('classroom_students').select('classroom_id, student_id, status').in('classroom_id', ids),
    ]);
    return JSON.stringify([
      ((cls.data || []) as Classroom[]).map((c) => [c.id, (c.students || []).map((s) => s.id), (c.pending_students || []).map((s) => s.id)]),
      (links.data || []).map((l: EnrollmentLink) => `${l.classroom_id}:${l.student_id}:${l.status}`).sort(),
    ]);
  },

  // ---------- LEARNING INDICATORS ----------
  async getLearningIndicators({ supabase, actor }: Ctx) {
    if (!actor) throw UNAUTHORIZED();
    const { data, error } = await supabase.from('learning_indicators').select('*').order('order_index');
    if (error) {
      console.warn('getLearningIndicators error:', error.message);
      return [];
    }
    return (data || []) as LearningIndicator[];
  },

  // ---------- ASSIGNMENTS ----------
  /** Teachers: their classrooms' assignments. Students: published work of classrooms they belong to. */
  async getAssignmentsByClassroomIds({ supabase, actor }: Ctx, classroomIds: string[]) {
    if (!actor) throw UNAUTHORIZED();
    const requested = [...new Set(classroomIds.filter(Boolean))];
    if (requested.length === 0) return [];
    if (actor.kind === 'teacher') {
      // One round trip: each row carries its classroom's teachers, checked here.
      const results = await Promise.all(
        chunk(requested).map((part) =>
          supabase.from('assignments').select('*, classroom:classrooms(teacher_id, teachers)').in('classroom_id', part)
        )
      );
      const failed = results.find((r) => r.error);
      if (failed?.error) throw toDatabaseError(failed.error, 'assignments');
      const rows = results.flatMap((r) => (r.data || []) as Array<Assignment & { classroom?: Pick<Classroom, 'teacher_id' | 'teachers'> | null }>);
      const mine = rows
        .filter((row) => row.classroom && isTeacherOf(row.classroom, actor.userId))
        .map(({ classroom: _classroom, ...assignment }) => assignment as Assignment);
      return teacherVisibleAssignments(supabase, mine);
    }
    const allowed = await studentClassroomIds(supabase, actor);
    return loadAssignments(supabase, requested.filter((id) => allowed.has(id)), false);
  },

  /**
   * The LINE student's published work in the given classrooms plus their own
   * submissions for it, in one request (the classroom check runs once).
   */
  async getStudentWork({ supabase, actor }: Ctx, classroomIds: string[]) {
    const me = requireStudent(actor);
    const requested = [...new Set(classroomIds.filter(Boolean))];
    if (requested.length === 0) return { assignments: [] as Assignment[], submissions: [] };
    const allowed = await studentClassroomIds(supabase, me);
    const assignments = await loadAssignments(supabase, requested.filter((id) => allowed.has(id)), false);
    const results = await Promise.all(
      chunk(assignments.map((a) => a.id)).map((part) =>
        supabase.from('submissions').select('*').in('assignment_id', part).in('student_id', me.keys)
      )
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) throw toDatabaseError(failed.error, 'submissions');
    return { assignments, submissions: results.flatMap((r) => r.data || []) };
  },

  /**
   * Fresh data for the teacher's export page (/exports): the chosen classrooms
   * with rosters, their work, every submission, per-question scores, questions
   * and attendance. Only classrooms this teacher teaches are returned; an empty
   * list means all of them.
   */
  async getTeacherExportData(ctx: Ctx, classroomIds: string[] = []) {
    requireTeacher(ctx.actor);
    const { supabase } = ctx;
    const mine = (await dataActions.getClassrooms(ctx, { withRoster: false })) as Classroom[];
    const wanted = new Set(classroomIds.filter(Boolean));
    const rows = wanted.size ? mine.filter((c) => wanted.has(c.id)) : mine;
    const ids = rows.map((c) => c.id);
    if (!ids.length) {
      return { classrooms: [] as Classroom[], assignments: [] as Assignment[], questions: [] as Question[], submissions: [] as Submission[], answers: [] as SubmissionAnswer[], sessions: [], records: [] };
    }
    // Every matching row: PostgREST returns at most 1000 per request, and an
    // export must never be silently cut short.
    const byChunks = async <T,>(table: string, columns: string, column: string, values: string[]) => {
      const pageSize = 1000;
      const readPart = async (part: string[]) => {
        const out: T[] = [];
        for (let from = 0; ; from += pageSize) {
          const { data, error } = await supabase.from(table).select(columns).in(column, part).range(from, from + pageSize - 1);
          if (error) throw toDatabaseError(error, table);
          out.push(...((data || []) as unknown as T[]));
          if (!data || data.length < pageSize) return out;
        }
      };
      return (await Promise.all(chunk(values).map(readPart))).flat();
    };
    const [classrooms, assignments, sessions, records] = await Promise.all([
      hydrateClassrooms(supabase, rows),
      loadAssignments(supabase, ids, true),
      byChunks<Record<string, unknown>>('attendance_sessions', 'id, classroom_id, title, starts_at, status', 'classroom_id', ids),
      byChunks<Record<string, unknown>>('attendance_records', 'session_id, classroom_id, student_id, status, checked_at, checked_in_by', 'classroom_id', ids),
    ]);
    const assignmentIds = assignments.map((a) => a.id);
    const [questions, submissions] = await Promise.all([
      byChunks<Question>('questions', 'id, assignment_id, type, question_text, max_score, indicator_id', 'assignment_id', assignmentIds),
      byChunks<Submission>('submissions', '*', 'assignment_id', assignmentIds),
    ]);
    const answers = await byChunks<SubmissionAnswer>(
      'submission_answers',
      'submission_id, question_id, teacher_score, teacher_comment, graded_at',
      'submission_id',
      submissions.map((s) => s.id)
    );
    return { classrooms, assignments, questions, submissions, answers, sessions, records };
  },

  /**
   * Everything the LIFF home screen needs, in one request: the student's
   * classrooms (their own roster entries only), published work, their
   * submissions and the score rows of those submissions. Replaces
   * getStudentClassrooms → getStudentWork → getAnswersForSubmissions, which
   * the phone had to wait for one after another.
   */
  async getStudentHome({ supabase, actor }: Ctx) {
    const me = requireStudent(actor);
    // One round for everything that only needs the student's ids: their
    // classrooms, enrollment rows, own account and own submissions (with score rows).
    const [fromRoster, links, ownUsers, submissionResult] = await Promise.all([
      findClassroomsContainingStudent(supabase, me.keys),
      supabase.from('classroom_students').select('classroom_id, student_id, status').in('student_id', me.keys),
      fetchUsersByKeys(supabase, me.keys),
      supabase
        .from('submissions')
        .select('*, submission_answers(id, submission_id, question_id, teacher_score, teacher_comment, graded_at)')
        .in('student_id', me.keys),
    ]);
    if (submissionResult.error) throw toDatabaseError(submissionResult.error, 'submissions');
    const ownLinks = (links.data || []) as EnrollmentLink[];
    const known = new Set(fromRoster.map((c) => c.id));
    const extraIds = [...new Set(ownLinks.map((l) => l.classroom_id))].filter((id) => !known.has(id));
    const rows = [...fromRoster];
    const classroomIds = [...known, ...extraIds];
    // Classrooms known only from an enrollment row, and the work of every classroom, at once.
    const [extra, assignments] = await Promise.all([
      extraIds.length
        ? supabase.from('classrooms').select('*').in('id', extraIds).then(({ data }) => (data || []) as Classroom[])
        : Promise.resolve([] as Classroom[]),
      loadAssignments(supabase, classroomIds, false),
    ]);
    rows.push(...extra);
    rows.sort(byCreatedDesc);
    const hydrated = await hydrateClassroomsForStudent(supabase, rows, me.keys, ownLinks, ownUsers);
    // Work of a classroom id that no longer exists is dropped with it.
    const existing = new Set(rows.map((c) => c.id));
    const visibleAssignments = assignments.filter((a) => existing.has(a.classroom_id));
    const assignmentIds = new Set(visibleAssignments.map((a) => a.id));
    const submissions: Submission[] = [];
    const answers: SubmissionAnswer[] = [];
    for (const row of (submissionResult.data || []) as Array<Submission & { submission_answers?: SubmissionAnswer[] }>) {
      if (!assignmentIds.has(row.assignment_id)) continue;
      const { submission_answers: rowAnswers, ...submission } = row;
      submissions.push(submission as Submission);
      answers.push(...(rowAnswers || []));
    }
    return { classrooms: hydrated.map((c) => classroomForStudent(c, me)), assignments: visibleAssignments, submissions, answers };
  },

  async getAssignmentsByClassroomId(ctx: Ctx, classroomId: string) {
    return dataActions.getAssignmentsByClassroomIds(ctx, [classroomId]);
  },

  /** The assignment with its questions. Students get published work of their classroom, without answer keys. */
  /** withClassroom: teachers also get the classroom with its roster (saves the grading page a request). */
  async getAssignmentById({ supabase, actor }: Ctx, id: string, options: { withClassroom?: boolean } = {}) {
    if (!actor) throw UNAUTHORIZED();
    const [assignmentResult, questionsResult] = await Promise.all([
      supabase.from('assignments').select('*, classroom:classrooms(*)').eq('id', id).maybeSingle(),
      supabase.from('questions').select('*').eq('assignment_id', id),
    ]);
    if (assignmentResult.error) throw toDatabaseError(assignmentResult.error, 'assignments');
    if (!assignmentResult.data) return { assignment: null, questions: [] as Question[] };
    const { classroom, ...row } = assignmentResult.data as Assignment & { classroom?: Classroom | null };
    const assignment = row as Assignment;
    const role = classroom ? await classroomRole(supabase, actor, classroom) : null;
    const questions = (questionsResult.data || []) as Question[];
    if (role === 'teacher') {
      if (!options.withClassroom) return { assignment, questions };
      const [hydrated] = await hydrateClassrooms(supabase, [classroom!]);
      return { assignment, questions, classroom: hydrated };
    }
    if (!role || !isAssignmentPublished(assignment)) throw FORBIDDEN();
    return { assignment, questions: questionsForStudent(questions) };
  },

  async getQuestions(ctx: Ctx, assignmentId: string) {
    return (await dataActions.getAssignmentById(ctx, assignmentId)).questions;
  },

  async createAssignment(
    { supabase, actor }: Ctx,
    assignmentData: Omit<Assignment, 'id' | 'created_at'>,
    questionsData: Omit<Question, 'id' | 'assignment_id'>[]
  ) {
    const me = requireTeacher(actor);
    const classroom = await requireTeacherOfClassroom(supabase, actor, assignmentData.classroom_id);
    const stamp = Date.now();
    const id = `assign-${stamp}-${Math.random().toString(36).slice(2, 6)}`;
    const newAssignment: Assignment = {
      ...withCleanAttachments(assignmentData),
      id,
      status_override: assignmentData.status_override || 'auto',
      created_at: new Date().toISOString(),
    };
    const newQuestions: Question[] = questionsData.map((q, idx) => ({ ...q, id: `q-${stamp}-${Math.random().toString(36).slice(2, 6)}-${idx}`, assignment_id: id }));

    // Databases without the newer optional columns still accept the assignment.
    let row: Partial<Assignment> = newAssignment;
    let { error } = await supabase.from('assignments').insert(row);
    for (const column of OPTIONAL_ASSIGNMENT_COLUMNS) {
      if (!error?.message?.includes(column)) continue;
      // Dropping a requested publish time would release the work right away; refuse instead.
      if (column === 'publish_at' && row.publish_at) throw new Error(PUBLISH_AT_MIGRATION_MESSAGE);
      if (column === 'attachments') assertAttachmentsFit(row);
      const { [column]: _unused, ...rest } = row;
      row = rest;
      ({ error } = await supabase.from('assignments').insert(row));
    }
    if (error) throw toDatabaseError(error, 'assignments');
    if (newQuestions.length > 0) {
      let { error: qError } = await supabase.from('questions').insert(newQuestions);
      // Databases without questions.is_required yet: every question stays required.
      if (qError?.message?.includes('is_required')) {
        ({ error: qError } = await supabase.from('questions').insert(newQuestions.map(({ is_required: _unused, ...q }) => q)));
      }
      if (qError) {
        await supabase.from('assignments').delete().eq('id', id);
        throw toDatabaseError(qError, 'questions');
      }
    }
    // The attached files were uploaded before the assignment existed; they now belong to it.
    await attachFiles(supabase, assignmentAttachmentUrls(newAssignment), id, [me.userId]);

    // Timeline post + LINE notification; best effort so creation is not blocked.
    // A draft gets its post when the teacher publishes it.
    if (!isAssignmentDraft(row)) try {
      await createClassroomPost(supabase, {
        classroom,
        authorId: me.userId,
        activityType: assignmentData.is_exam ? 'exam' : 'assignment',
        body: assignmentPostBody(assignmentData),
        metadata: { assignmentId: id, dueDate: assignmentData.due_date, groupName: assignmentData.group_name || (assignmentData.is_exam ? 'ข้อสอบ' : 'งานทั่วไป') },
        // Only when the database kept publish_at; otherwise the assignment is already visible.
        publishAt: row.publish_at || undefined,
      });
    } catch (postError) {
      console.warn('Unable to publish assignment activity:', postError);
    }
    return { assignment: newAssignment, questions: newQuestions };
  },

  async updateAssignment({ supabase, actor }: Ctx, id: string, data: Partial<Omit<Assignment, 'id' | 'created_at'>>) {
    const { assignment: previous } = await requireTeacherOfAssignment(supabase, actor, id);
    // Moving work to another classroom is not an edit.
    const { classroom_id: _cls, ...rest } = data as Partial<Assignment>;
    let patch: Partial<Assignment> = withCleanAttachments(rest);

    const due = new Date(patch.due_date ?? previous.due_date).getTime();
    const publishAt = patch.publish_at ?? previous.publish_at;
    const toDraft = isAssignmentDraft({ publish_at: publishAt });
    if (publishAt && !toDraft && patch.due_date && due <= new Date(publishAt).getTime()) {
      throw new HttpError(400, 'กำหนดส่งต้องอยู่หลังเวลาเผยแพร่');
    }

    let { data: updated, error } = await supabase.from('assignments').update(patch).eq('id', id).select().maybeSingle();
    for (const column of OPTIONAL_ASSIGNMENT_COLUMNS) {
      if (!error?.message?.includes(column)) continue;
      if (column === 'publish_at' && patch.publish_at) throw new Error(PUBLISH_AT_MIGRATION_MESSAGE);
      if (column === 'attachments') assertAttachmentsFit(patch);
      const { [column]: _unused, ...others } = patch;
      patch = others;
      ({ data: updated, error } = await supabase.from('assignments').update(patch).eq('id', id).select().maybeSingle());
    }
    if (error) throw toDatabaseError(error, 'assignments');

    // Newly attached files belong to this assignment; removed ones leave storage.
    if (patch.attachments !== undefined || patch.sample_work_url !== undefined) {
      const nextUrls = assignmentAttachmentUrls({ ...previous, ...patch });
      await attachFiles(supabase, nextUrls, id, [requireTeacher(actor).userId]);
      const kept = new Set(keysFromUrls(nextUrls));
      const removedUrls = assignmentAttachmentUrls(previous).filter((url) => { const [key] = keysFromUrls([url]); return key && !kept.has(key); });
      if (removedUrls.length) {
        // Copies in other classrooms share the same files; those stay.
        const shared = await attachmentKeysInUse(supabase, removedUrls, [id]);
        const oldKeys = keysFromUrls(removedUrls).filter((key) => !shared.has(key));
        if (oldKeys.length) after(() => removeFiles(supabase, oldKeys));
      }
    }

    const next = (updated as Assignment) || { ...previous, ...patch };
    const wasDraft = isAssignmentDraft(previous);
    const nextPublishMs = patch.publish_at ? new Date(patch.publish_at).getTime() : NaN;
    if (toDraft && !wasDraft) {
      // Scheduled work turned back into a draft: drop its held-back post (it was never announced).
      await supabase.from('classroom_posts').delete().contains('metadata', { assignmentId: id, pendingLine: true });
    } else if (wasDraft && !toDraft && !Number.isNaN(nextPublishMs) && nextPublishMs > Date.now()) {
      // A draft given a release time: its timeline post (and LINE announcement) waits for that time.
      try {
        const classroom = await loadClassroom(supabase, previous.classroom_id);
        if (classroom) {
          await createClassroomPost(supabase, {
            classroom,
            authorId: requireTeacher(actor).userId,
            activityType: next.is_exam ? 'exam' : 'assignment',
            body: assignmentPostBody(next),
            metadata: { assignmentId: id, dueDate: next.due_date, groupName: next.group_name || (next.is_exam ? 'ข้อสอบ' : 'งานทั่วไป') },
            publishAt: new Date(nextPublishMs).toISOString(),
          });
        }
      } catch (postError) {
        console.warn('Unable to schedule draft activity:', postError);
      }
    } else if (!toDraft && !Number.isNaN(nextPublishMs) && nextPublishMs > Date.now() && nextPublishMs !== new Date(previous.publish_at || 0).getTime()) {
      // A rescheduled release moves its held-back timeline post (and LINE announcement) too.
      const publishIso = new Date(nextPublishMs).toISOString();
      const { data: scheduledPosts } = await supabase.from('classroom_posts').select('id, metadata').contains('metadata', { assignmentId: id, pendingLine: true });
      await Promise.all(
        (scheduledPosts || []).map((p) =>
          supabase.from('classroom_posts').update({ created_at: publishIso, metadata: { ...(p.metadata || {}), publishAt: publishIso } }).eq('id', p.id)
        )
      );
    }

    // The timeline post spells out the title and due date; keep it in step.
    const dueChanged = patch.due_date && new Date(patch.due_date).getTime() !== new Date(previous.due_date).getTime();
    if (dueChanged || (patch.title && patch.title !== previous.title)) {
      const { data: posts } = await supabase.from('classroom_posts').select('id, body, metadata').contains('metadata', { assignmentId: id });
      await Promise.all(
        (posts || [])
          .filter((p) => /^(งานใหม่|ข้อสอบใหม่):/.test(p.body || ''))
          .map((p) =>
            supabase
              .from('classroom_posts')
              .update({ body: assignmentPostBody(next), metadata: { ...(p.metadata || {}), dueDate: next.due_date } })
              .eq('id', p.id)
          )
      );
      after(() => signalClassroom(previous.classroom_id, { type: 'timeline' }));
    }
    return (updated as Assignment) || null;
  },

  /**
   * Replaces an assignment's questions with the edited set (full edit). Questions
   * keep their id, so students' answers stay attached; a question left out is
   * deleted together with its answers. total_points follows the new scores.
   * Every handed-in choice / true-false answer is re-scored from the new key
   * (scores the teacher adjusted by hand are kept), answers to a question that
   * is no longer a choice question go back to "to grade", and every
   * submission's total follows the new set of questions. Students' handed-in
   * work stays locked; the teacher reopens it per student when they should
   * answer again.
   */
  async replaceAssignmentQuestions(
    { supabase, actor }: Ctx,
    id: string,
    questionsData: Array<Omit<Question, 'assignment_id' | 'id'> & { id?: string }>
  ) {
    const { assignment } = await requireTeacherOfAssignment(supabase, actor, id);
    const { data: existing, error: loadError } = await supabase.from('questions').select('*').eq('assignment_id', id);
    if (loadError) throw toDatabaseError(loadError, 'questions');
    const previousById = new Map(((existing || []) as Question[]).map((q) => [q.id, q]));
    const existingIds = new Set(previousById.keys());
    const stamp = Date.now();
    const rows: Question[] = questionsData.map((q, idx) => ({
      ...q,
      // Only ids of this assignment's own questions are kept; anything else becomes a new question.
      id: q.id && existingIds.has(q.id) ? q.id : `q-${stamp}-${Math.random().toString(36).slice(2, 6)}-${idx}`,
      assignment_id: id,
    }));

    if (rows.length > 0) {
      let { error } = await supabase.from('questions').upsert(rows);
      // Databases without questions.is_required yet: every question stays required.
      if (error?.message?.includes('is_required')) {
        ({ error } = await supabase.from('questions').upsert(rows.map(({ is_required: _unused, ...q }) => q)));
      }
      if (error) throw toDatabaseError(error, 'questions');
    }
    const keep = new Set(rows.map((q) => q.id));
    const removed = [...existingIds].filter((qid) => !keep.has(qid));
    if (removed.length) {
      // Their answers are deleted with them; so are files students uploaded for them.
      const fileKeys = await questionFileKeys(supabase, removed);
      const { error } = await supabase.from('questions').delete().in('id', removed);
      if (error) throw toDatabaseError(error, 'questions');
      after(() => removeFiles(supabase, fileKeys));
    }
    const totalPoints = rows.reduce((sum, q) => sum + Number(q.max_score || 0), 0);
    await supabase.from('assignments').update({ total_points: totalPoints }).eq('id', id);

    // Every kept choice / true-false question is re-scored for everyone who
    // handed in, not only the ones whose key visibly changed: a fixed key,
    // options, points or type all reach every student. Unchanged questions
    // re-score to the same value (nothing written); hand-adjusted scores stay.
    const kept = rows.filter((q) => previousById.has(q.id));
    await regradeObjectiveQuestions(
      supabase,
      id,
      kept.filter((q) => isObjectiveQuestion(q)).map((q) => ({ before: previousById.get(q.id) || null, after: q }))
    );
    // A choice question turned into a written one goes back to the teacher.
    await clearRetiredAutoScores(supabase, kept.map((q) => ({ before: previousById.get(q.id)!, after: q })));
    // "No submission" students get 0 on questions added now too.
    await zeroFillNoSubmissions(supabase, id, rows.filter((q) => !previousById.has(q.id)).map((q) => q.id));
    // Added / removed questions and new points change every total.
    await recomputeSubmissionTotals(supabase, id);
    after(() => signalClassroom(assignment.classroom_id, { type: 'submission', assignmentId: id }));
    return rows;
  },

  /**
   * Corrects one choice / true-false question's answer key from the grading
   * page and re-scores every submitted answer to it (manual adjustments kept).
   */
  async updateAnswerKey({ supabase, actor }: Ctx, assignmentId: string, questionId: string, idealAnswer: string) {
    const { assignment } = await requireTeacherOfAssignment(supabase, actor, assignmentId);
    const { data: row, error } = await supabase.from('questions').select('*').eq('id', questionId).eq('assignment_id', assignmentId).maybeSingle();
    if (error) throw toDatabaseError(error, 'questions');
    const before = row as Question | null;
    if (!before) throw new HttpError(404, 'ไม่พบคำถามนี้');
    if (!isObjectiveQuestion(before)) throw new HttpError(400, 'แก้เฉลยได้เฉพาะข้อปรนัยและข้อถูก/ผิด');
    const key = String(idealAnswer || '').trim();
    if (!key) throw new HttpError(400, 'กรุณาเลือกคำตอบที่ถูกต้อง');
    const corrected: Question = { ...before, ideal_answer: key };
    const { error: updateError } = await supabase.from('questions').update({ ideal_answer: key }).eq('id', questionId);
    if (updateError) throw toDatabaseError(updateError, 'questions');
    const result = await regradeObjectiveQuestions(supabase, assignmentId, [{ before, after: corrected }]);
    // Students with the result open see the new score.
    after(() => signalClassroom(assignment.classroom_id, { type: 'submission', assignmentId }));
    return { question: corrected, ...result };
  },

  /**
   * Saves a drag in the classroom's work list: new positions for one group's
   * cards, and the new group of the card that moved (null = default group).
   */
  async reorderAssignments(
    { supabase, actor }: Ctx,
    classroomId: string,
    updates: Array<{ id: string; sort_order: number; group_name?: string | null }>
  ) {
    await requireTeacherOfClassroom(supabase, actor, classroomId);
    const ids = updates.map((u) => u.id);
    const { data: rows } = await supabase.from('assignments').select('id').eq('classroom_id', classroomId).in('id', ids);
    if ((rows || []).length !== new Set(ids).size) throw FORBIDDEN();
    const results = await Promise.all(
      updates.map(({ id, sort_order, group_name }) =>
        supabase
          .from('assignments')
          .update({ sort_order, ...(group_name !== undefined ? { group_name } : {}) })
          .eq('id', id)
      )
    );
    const failed = results.find((r) => r.error)?.error;
    if (failed?.message?.includes('sort_order')) {
      throw new HttpError(409, 'ฐานข้อมูลยังไม่รองรับการเรียงลำดับงาน กรุณารัน SQL ใน supabase_assignment_order_update.sql ก่อน');
    }
    if (failed) throw toDatabaseError(failed, 'assignments');
    after(() => signalClassroom(classroomId, { type: 'timeline' }));
    return true;
  },

  async deleteAssignment({ supabase, actor }: Ctx, id: string) {
    const { assignment } = await requireTeacherOfAssignment(supabase, actor, id);
    // Students' uploaded work and the reference file are deleted from storage with it.
    const fileKeys = await assignmentFileKeys(supabase, [id]);
    await Promise.all([
      supabase.from('questions').delete().eq('assignment_id', id),
      supabase.from('submissions').delete().eq('assignment_id', id),
      supabase.from('classroom_posts').delete().contains('metadata', { assignmentId: id }),
    ]);
    const { error } = await supabase.from('assignments').delete().eq('id', id);
    if (error) throw toDatabaseError(error, 'assignments');
    after(() => removeFiles(supabase, fileKeys));
    after(() => signalClassroom(assignment.classroom_id, { type: 'timeline' }));
    return true;
  },

  // ---------- SUBMISSIONS ----------
  async getSubmissionEvents({ supabase, actor }: Ctx, submissionId: string) {
    await requireTeacherOfSubmission(supabase, actor, submissionId);
    const { data, error } = await supabase.from('submission_events').select('*').eq('submission_id', submissionId).order('created_at', { ascending: true });
    if (error) throw toDatabaseError(error, 'submission_events');
    return (data || []) as SubmissionEvent[];
  },

  /** A submission's answers: for its teachers, or for the student who wrote it. */
  async getSubmissionAnswers({ supabase, actor }: Ctx, submissionId: string) {
    await requireSubmissionAccess(supabase, actor, submissionId);
    const { data, error } = await supabase.from('submission_answers').select('*').eq('submission_id', submissionId);
    if (error) throw toDatabaseError(error, 'submission_answers');
    const mapped: Record<string, SubmissionAnswer> = {};
    for (const ans of (data || []) as SubmissionAnswer[]) {
      // Students see their own scores and comments, not other teachers' or researchers' grades.
      mapped[ans.question_id] = actor?.kind === 'student' ? { ...ans, co_grades: undefined, research_grades: undefined } : ans;
    }
    return mapped;
  },

  /** Score rows for the student's own submissions (LIFF result badges). */
  async getAnswersForSubmissions({ supabase, actor }: Ctx, submissionIds: string[]) {
    if (!actor) throw UNAUTHORIZED();
    let ids = [...new Set(submissionIds.filter(Boolean))];
    if (ids.length === 0) return [];
    if (actor.kind === 'student') {
      const { data: own } = await supabase.from('submissions').select('id').in('id', ids).in('student_id', actor.keys);
      ids = (own || []).map((r: { id: string }) => r.id);
    } else {
      const allowed = await teacherClassroomIds(supabase, actor.userId);
      const { data: subs } = await supabase.from('submissions').select('id, assignment_id').in('id', ids);
      const assignmentIds = [...new Set((subs || []).map((s) => s.assignment_id))];
      const { data: assigns } = assignmentIds.length ? await supabase.from('assignments').select('id, classroom_id').in('id', assignmentIds) : { data: [] };
      const okAssignments = new Set((assigns || []).filter((a) => allowed.has(a.classroom_id)).map((a) => a.id));
      ids = (subs || []).filter((s) => okAssignments.has(s.assignment_id)).map((s) => s.id);
    }
    if (ids.length === 0) return [];
    const results = await Promise.all(
      chunk(ids).map((part) =>
        supabase.from('submission_answers').select('id, submission_id, question_id, teacher_score, teacher_comment, graded_at').in('submission_id', part)
      )
    );
    return results.flatMap((r) => (r.data || []) as SubmissionAnswer[]);
  },

  /**
   * The student's own result sheet in one request: the assignment's questions
   * (without answer keys) and their answers with the teacher's scores and
   * comments. Replaces getQuestions + getSubmissionAnswers on the LIFF.
   */
  async getStudentResult({ supabase, actor }: Ctx, submissionId: string) {
    const me = requireStudent(actor);
    const { data, error } = await supabase
      .from('submissions')
      .select('id, submission_answers(*), assignment:assignments(*, questions(*), classroom:classrooms(id, teacher_id, teachers, students, pending_students))')
      .eq('id', submissionId)
      .in('student_id', me.keys)
      .maybeSingle();
    if (error) throw toDatabaseError(error, 'submissions');
    if (!data) throw new HttpError(404, 'ไม่พบงานที่ส่ง');
    type Row = {
      submission_answers: SubmissionAnswer[] | null;
      assignment: (Assignment & { questions?: Question[] | null; classroom?: Classroom | null }) | null;
    };
    const row = data as unknown as Row;
    const { questions, classroom, ...assignment } = row.assignment || ({} as NonNullable<Row['assignment']>);
    // Same rule as getAssignmentById: published work of a classroom the student belongs to.
    const role = classroom ? await classroomRole(supabase, actor, classroom) : null;
    if (!role || !isAssignmentPublished(assignment as Assignment)) throw FORBIDDEN();
    const answers: Record<string, SubmissionAnswer> = {};
    // Students see their own scores and comments, not other teachers' or researchers' grades.
    for (const ans of row.submission_answers || []) answers[ans.question_id] = { ...ans, co_grades: undefined, research_grades: undefined };
    return { questions: questionsForStudent(questions || []), answers };
  },

  /** Saves one grade; see saveTeacherGrades. */
  async saveTeacherGrade(
    ctx: Ctx,
    submissionId: string,
    questionId: string,
    teacherScore: number,
    teacherComment: string,
    _teacherId: string,
    teacherName: string
  ) {
    await dataActions.saveTeacherGrades(ctx, submissionId, [{ questionId, score: teacherScore, comment: teacherComment }], teacherName);
  },

  /**
   * Saves several question grades of one submission in one go: one access
   * check (which also brings the questions and the current answer rows), one
   * write, then the official total. The server decides from the classroom
   * whether the grades are official or research-only.
   */
  async saveTeacherGrades(
    { supabase, actor }: Ctx,
    submissionId: string,
    grades: Array<{ questionId: string; score: number; comment?: string | null }>,
    teacherName: string
  ) {
    const me = requireTeacher(actor);
    if (!Array.isArray(grades) || grades.length === 0) return;
    const { data, error } = await supabase
      .from('submissions')
      .select('id, assignment_id, status, submission_answers(*), assignment:assignments(id, classroom:classrooms(id, teacher_id, teachers), questions(id, max_score))')
      .eq('id', submissionId)
      .maybeSingle();
    if (error) throw toDatabaseError(error, 'submissions');
    if (!data) throw new HttpError(404, 'ไม่พบงานที่ส่ง');
    type Row = {
      assignment_id: string;
      status: Submission['status'];
      submission_answers: SubmissionAnswer[] | null;
      assignment: { classroom: Pick<Classroom, 'id' | 'teacher_id' | 'teachers'> | null; questions: Pick<Question, 'id' | 'max_score'>[] | null } | null;
    };
    const row = data as unknown as Row;
    const classroom = row.assignment?.classroom;
    if (!classroom) throw new HttpError(404, 'ไม่พบห้องเรียน');
    if (!isTeacherOf(classroom, me.userId)) throw FORBIDDEN();
    // Only work the student handed in is graded. A student who handed in
    // nothing gets "no submission" (an official 0) from recordMissingSubmissions,
    // which also checks the deadline; any other score would grade work that does not exist.
    if (!isHandedIn(row)) throw new HttpError(409, 'นักเรียนยังไม่ได้ส่งงาน จึงให้คะแนนไม่ได้ — หลังกำหนดส่งหรือปิดรับงาน ใช้ "บันทึกว่าไม่ส่ง" เพื่อให้ 0 คะแนน');
    // The grading role comes from the classroom, not from the browser.
    const teacherRole: TeacherRole = classroom.teacher_id === me.userId
      ? 'primary'
      : (classroom.teachers || []).find((t) => t.teacher_id === me.userId)?.role || 'assistant';
    const isOfficial = teacherRole === 'primary' || teacherRole === 'assistant';
    const isResearcher = teacherRole === 'researcher';

    const questions = row.assignment?.questions || [];
    const maxScoreOf = new Map(questions.map((q) => [q.id, Number(q.max_score || 0)]));
    const existingOf = new Map((row.submission_answers || []).map((a) => [a.question_id, a]));
    const gradedAt = new Date().toISOString();
    // The last grade of a question wins if the browser sent it twice.
    const byQuestion = new Map<string, { score: number; comment: string }>();
    for (const grade of grades) {
      const score = Number(grade?.score);
      if (!grade || typeof grade.questionId !== 'string' || !maxScoreOf.has(grade.questionId)) throw new HttpError(400, 'ไม่พบคำถามนี้ในงาน');
      if (!Number.isFinite(score) || score < 0 || score > maxScoreOf.get(grade.questionId)!) throw new HttpError(400, 'คะแนนไม่ถูกต้อง');
      byQuestion.set(grade.questionId, { score, comment: typeof grade.comment === 'string' ? grade.comment : '' });
    }
    // Reuse each row when it exists: UNIQUE(submission_id, question_id) forbids a second.
    const rows = [...byQuestion].map(([questionId, { score, comment }]) => {
      const existing = (existingOf.get(questionId) || {}) as Partial<SubmissionAnswer>;
      const record: TeacherGradeRecord = {
        teacher_id: me.userId,
        teacher_name: teacherName,
        teacher_role: teacherRole,
        score,
        comment,
        graded_at: gradedAt,
      };
      return {
        id: existing.id || `ans-${submissionId}-${questionId}`,
        submission_id: submissionId,
        question_id: questionId,
        teacher_score: isOfficial ? score : existing.teacher_score ?? null,
        teacher_comment: isOfficial ? comment : existing.teacher_comment ?? null,
        co_grades: { ...(existing.co_grades || {}), [me.userId]: record },
        research_grades: isResearcher ? { ...(existing.research_grades || {}), [me.userId]: record } : existing.research_grades || {},
        graded_at: isOfficial ? gradedAt : existing.graded_at ?? null,
        updated_at: gradedAt,
      };
    });
    const { error: writeError } = await supabase.from('submission_answers').upsert(rows, { onConflict: 'submission_id,question_id' });
    if (writeError) throw toDatabaseError(writeError, 'submission_answers');
    if (isOfficial) {
      // Total = sum of official scores, set once every question has one (read after the write).
      await recomputeSubmissionTotals(supabase, row.assignment_id, [submissionId], questions);
      // Open score tables (classroom grades tab, co-teachers, the student) refetch.
      const assignmentId = row.assignment_id;
      after(() => signalClassroom(classroom.id, { type: 'submission', assignmentId }));
    }
  },

  /**
   * Lets one student hand in again, or takes that back:
   * - handed-in homework: edit it (after it was graded or closed); scores stay
   *   until the student hands in the edited work, which replaces them;
   * - work recorded as "no submission" (a 'pending' row, homework or quiz):
   *   hand it in although it closed; the work replaces the 0.
   * Handed-in quizzes are never reopened. `until` limits the permission to
   * that time (ISO, in the future); null = no limit.
   */
  async setSubmissionReopened({ supabase, actor }: Ctx, submissionId: string, open: boolean, until?: unknown) {
    const { classroom } = await requireTeacherOfSubmission(supabase, actor, submissionId);
    const me = requireTeacher(actor);
    const role = classroom.teacher_id === me.userId ? 'primary' : (classroom.teachers || []).find((t) => t.teacher_id === me.userId)?.role;
    if (role === 'researcher') throw FORBIDDEN();
    const { data: sub, error: readError } = await supabase.from('submissions').select('id, assignment_id, status').eq('id', submissionId).maybeSingle();
    if (readError) throw toDatabaseError(readError, 'submissions');
    if (!sub) throw new HttpError(404, 'ไม่พบงานที่ส่ง');
    const { data: assignment } = await supabase.from('assignments').select('id, is_exam').eq('id', sub.assignment_id).maybeSingle();
    if (assignment?.is_exam && isHandedIn(sub as Pick<Submission, 'status'>)) throw new HttpError(400, 'ข้อสอบที่ส่งแล้วส่งซ้ำหรือแก้ไขไม่ได้');
    const reopenUntil = open ? parseReopenUntil(until) : null;
    const reopenedAt = open ? new Date().toISOString() : null;
    await writeReopen(supabase, reopenedAt, reopenUntil, (query) => query.eq('id', submissionId));
    // The student's LIFF page reloads their work and shows the edit / hand-in button.
    after(() => signalClassroom(classroom.id, { type: 'timeline' }));
    return { reopened_at: reopenedAt, reopen_until: reopenUntil };
  },

  /**
   * "Allow hand-in" for a roster student who has no row for this work yet
   * (never handed in, never recorded): creates a 'pending' row, unscored, that
   * carries the permission, so they can hand in after it closed. A student who
   * already has a row is handled like setSubmissionReopened. Returns the row.
   */
  async allowStudentHandIn({ supabase, actor }: Ctx, assignmentId: string, rosterId: string, until?: unknown) {
    const me = requireTeacher(actor);
    const { classroom } = await requireTeacherOfAssignment(supabase, actor, assignmentId);
    const role = classroom.teacher_id === me.userId ? 'primary' : (classroom.teachers || []).find((t) => t.teacher_id === me.userId)?.role;
    if (role === 'researcher') throw FORBIDDEN();
    const rosterEntry = (classroom.students || []).find((s) => s && s.id === rosterId);
    if (!rosterEntry) throw new HttpError(404, 'ไม่พบนักเรียนคนนี้ในห้องเรียน');
    const keys = [...new Set([rosterEntry.id, rosterEntry.line_uid].filter((k): k is string => !!k))];
    const quoted = keys.map(pgValue).join(',');
    const { data: users, error: userError } = await supabase.from('users').select('id, line_uid').or(`id.in.(${quoted}),line_uid.in.(${quoted})`);
    if (userError) throw toDatabaseError(userError, 'users');
    const user = (users || []).find((u) => u.id === rosterEntry.id) || (users || [])[0];
    if (!user) throw new HttpError(404, 'นักเรียนคนนี้ยังไม่มีบัญชีในระบบ (ยังไม่เคยเข้าใช้ผ่าน LINE)');
    const reopenUntil = parseReopenUntil(until);
    const reopenedAt = new Date().toISOString();

    const { data: existing, error: existingError } = await supabase
      .from('submissions')
      .select('*')
      .eq('assignment_id', assignmentId)
      .eq('student_id', user.id)
      .maybeSingle();
    if (existingError) throw toDatabaseError(existingError, 'submissions');
    if (existing) {
      if (isHandedIn(existing as Submission)) throw new HttpError(409, 'นักเรียนส่งงานนี้แล้ว — ใช้ "ให้แก้ไขงาน" แทน');
      await writeReopen(supabase, reopenedAt, reopenUntil, (query) => query.eq('id', existing.id));
      after(() => signalClassroom(classroom.id, { type: 'timeline' }));
      return { ...(existing as Submission), reopened_at: reopenedAt, reopen_until: reopenUntil } as Submission;
    }

    const row: Record<string, unknown> = {
      id: `sub-${assignmentId}-${user.id}`,
      assignment_id: assignmentId,
      student_id: user.id,
      status: 'pending',
      started_at: reopenedAt,
      submitted_at: null,
      time_spent_seconds: 0,
      tab_switch_count: 0,
      total_time_away_seconds: 0,
      is_flagged_suspicious: false,
      total_score: null,
      reopened_at: reopenedAt,
      ...(reopenUntil ? { reopen_until: reopenUntil } : {}),
    };
    // A student handing in at this very moment wins; their row is not replaced.
    const { data: created, error: insertError } = await supabase
      .from('submissions')
      .upsert(row, { onConflict: 'assignment_id,student_id', ignoreDuplicates: true })
      .select('*')
      .maybeSingle();
    if (insertError) {
      if (/reopen(ed_at|_until)/.test(insertError.message)) throw new HttpError(503, REOPEN_MIGRATION_MESSAGE);
      throw toDatabaseError(insertError, 'submissions');
    }
    after(() => signalClassroom(classroom.id, { type: 'timeline' }));
    return (created || row) as unknown as Submission;
  },

  /**
   * "Allow edit" for every student who handed in this homework (e.g. after the
   * teacher fixed a wrongly made assignment), or takes it back from everyone.
   * Same rules and time limit (`until`, ISO or null) as setSubmissionReopened.
   * Opening covers everyone whose work is locked (never allowed, or their time
   * ran out); students with a permission still running keep their own.
   * Returns the rows changed and the values written, so the page can show
   * them without refetching.
   */
  async setAllSubmissionsReopened({ supabase, actor }: Ctx, assignmentId: string, open: boolean, until?: unknown) {
    const me = requireTeacher(actor);
    const { assignment, classroom } = await requireTeacherOfAssignment(supabase, actor, assignmentId);
    const role = classroom.teacher_id === me.userId ? 'primary' : (classroom.teachers || []).find((t) => t.teacher_id === me.userId)?.role;
    if (role === 'researcher') throw FORBIDDEN();
    if (assignment.is_exam) throw new HttpError(400, 'ข้อสอบส่งซ้ำหรือแก้ไขไม่ได้');
    const reopenUntil = open ? parseReopenUntil(until) : null;
    const reopenedAt = open ? new Date().toISOString() : null;
    const run = (withLimit: boolean) => {
      let query = supabase
        .from('submissions')
        .update(withLimit ? { reopened_at: reopenedAt, reopen_until: reopenUntil } : { reopened_at: reopenedAt })
        .eq('assignment_id', assignmentId)
        .in('status', ['submitted', 'late']);
      if (!open) query = query.not('reopened_at', 'is', null);
      else if (withLimit) query = query.or(`reopened_at.is.null,reopen_until.lt."${reopenedAt}"`);
      else query = query.is('reopened_at', null);
      return query.select('id');
    };
    let { data, error } = await run(true);
    // Databases without reopen_until: only a permission with no limit can be stored.
    if (error?.message.includes('reopen_until') && !reopenUntil) ({ data, error } = await run(false));
    if (error) {
      if (/reopen(ed_at|_until)/.test(error.message)) throw new HttpError(503, REOPEN_MIGRATION_MESSAGE);
      throw toDatabaseError(error, 'submissions');
    }
    after(() => signalClassroom(classroom.id, { type: 'timeline' }));
    const ids = (data || []).map((row) => row.id as string);
    return { changed: ids.length, ids, reopened_at: reopenedAt, reopen_until: reopenUntil };
  },

  /**
   * Records that students handed in nothing: a 'pending' row (not handed in)
   * with an official 0 on every question. Allowed only once the deadline has
   * passed or the work is closed (canRecordNoSubmission), so it never scores
   * work a student could still hand in. While homework still takes late work,
   * a student handing in replaces the 0 with their work. Roster entries may
   * carry users.id or the LINE id. Students who handed in are left alone;
   * rows already recorded are set to 0 again (e.g. after questions were added).
   * Returns the rows recorded.
   */
  async recordMissingSubmissions(
    { supabase, actor }: Ctx,
    assignmentId: string,
    rosterIds: string[],
    nameArg: unknown,
    /** Tabs still running the previous page send (ids, zero, name); the name is then the 4th argument. */
    legacyName?: unknown
  ) {
    const me = requireTeacher(actor);
    const teacherName = typeof nameArg === 'string' ? nameArg : typeof legacyName === 'string' ? legacyName : 'คุณครู';
    const { assignment, classroom } = await requireTeacherOfAssignment(supabase, actor, assignmentId);
    const teacherRole: TeacherRole = classroom.teacher_id === me.userId
      ? 'primary'
      : (classroom.teachers || []).find((t) => t.teacher_id === me.userId)?.role || 'assistant';
    if (teacherRole === 'researcher') throw new HttpError(403, 'ผู้วิจัยให้คะแนนจริงแทนคุณครูไม่ได้');
    if (!canRecordNoSubmission(getAssignmentWindow(assignment))) {
      throw new HttpError(409, 'บันทึกว่าไม่ส่งงานได้หลังเลยกำหนดส่งหรือปิดรับงานแล้วเท่านั้น');
    }

    const wanted = new Set((Array.isArray(rosterIds) ? rosterIds : []).filter((id): id is string => typeof id === 'string' && !!id));
    const roster = (classroom.students || []).filter((s) => s && wanted.has(s.id));
    const keys = [...new Set(roster.flatMap((s) => [s.id, s.line_uid]).filter((k): k is string => !!k))];
    if (!keys.length) return [];
    const users: Array<{ id: string; line_uid?: string | null }> = [];
    for (const part of chunk(keys)) {
      const quoted = part.map(pgValue).join(',');
      const { data, error } = await supabase.from('users').select('id, line_uid').or(`id.in.(${quoted}),line_uid.in.(${quoted})`);
      if (error) throw toDatabaseError(error, 'users');
      users.push(...((data || []) as typeof users));
    }
    // submissions.student_id is users.id: find each roster entry's account.
    const userIds = [
      ...new Set(
        roster.flatMap((s) => {
          const user = users.find((u) => u.id === s.id) || users.find((u) => !!s.line_uid && (u.id === s.line_uid || u.line_uid === s.line_uid));
          return user ? [user.id] : [];
        })
      ),
    ];
    if (!userIds.length) return [];

    // Handed-in work is never touched; rows already recorded as not handed in are re-zeroed.
    const handedIn = new Set<string>();
    const recorded: Array<{ id: string; student_id: string }> = [];
    for (const part of chunk(userIds)) {
      const { data, error } = await supabase.from('submissions').select('id, student_id, status').eq('assignment_id', assignmentId).in('student_id', part);
      if (error) throw toDatabaseError(error, 'submissions');
      for (const row of (data || []) as Array<{ id: string; student_id: string; status: Submission['status'] }>) {
        if (isHandedIn(row)) handedIn.add(row.student_id);
        else recorded.push(row);
      }
    }
    const recordedIds = new Set(recorded.map((r) => r.student_id));
    const missing = userIds.filter((id) => !handedIn.has(id) && !recordedIds.has(id));

    const { data: questions, error: qError } = await supabase.from('questions').select('id, max_score').eq('assignment_id', assignmentId);
    if (qError) throw toDatabaseError(qError, 'questions');
    const qs = (questions || []) as Pick<Question, 'id' | 'max_score'>[];
    const maxTotal = qs.reduce((sum, q) => sum + Number(q.max_score || 0), 0) || assignment.total_points || 20;
    const now = new Date().toISOString();
    let createdRows: Array<{ id: string }> = [];
    if (missing.length) {
      const rows = missing.map((studentId) => ({
        id: `sub-${assignmentId}-${studentId}`,
        assignment_id: assignmentId,
        student_id: studentId,
        status: 'pending',
        started_at: now,
        submitted_at: null,
        time_spent_seconds: 0,
        tab_switch_count: 0,
        total_time_away_seconds: 0,
        is_flagged_suspicious: false,
        total_score: 0,
        max_total_score: maxTotal,
      }));
      // A student handing in at this very moment wins; their row is not replaced.
      const { data: created, error: insertError } = await supabase
        .from('submissions')
        .upsert(rows, { onConflict: 'assignment_id,student_id', ignoreDuplicates: true })
        .select('*');
      if (insertError) throw toDatabaseError(insertError, 'submissions');
      createdRows = (created || []) as Array<{ id: string }>;
    }
    if (recorded.length) {
      for (const part of chunk(recorded.map((r) => r.id))) {
        // Still guarded by status: work handed in meanwhile keeps its own score.
        const { error } = await supabase
          .from('submissions')
          .update({ total_score: 0, max_total_score: maxTotal })
          .in('id', part)
          .eq('status', 'pending');
        if (error) throw toDatabaseError(error, 'submissions');
      }
    }

    const zeroed = [...createdRows.map((r) => r.id), ...recorded.map((r) => r.id)];
    if (qs.length && zeroed.length) {
      const record: TeacherGradeRecord = { teacher_id: me.userId, teacher_name: teacherName, teacher_role: teacherRole, score: 0, comment: '', graded_at: now };
      const answers = zeroed.flatMap((subId) =>
        qs.map((q) => ({
          id: `ans-${subId}-${q.id}`,
          submission_id: subId,
          question_id: q.id,
          text_answer: '',
          teacher_score: 0,
          teacher_comment: '',
          co_grades: { [me.userId]: record },
          graded_at: now,
          updated_at: now,
        }))
      );
      for (const part of chunk(answers, 500)) {
        const { error } = await supabase.from('submission_answers').upsert(part, { onConflict: 'submission_id,question_id' });
        if (error) throw toDatabaseError(error, 'submission_answers');
      }
    }
    after(() => signalClassroom(classroom.id, { type: 'submission', assignmentId }));
    return [...createdRows, ...recorded];
  },

  /**
   * Takes back "handed in nothing" for one student: removes the recorded row
   * and its 0s, so the student counts as missing again. Handed-in work is never removed here.
   */
  async clearMissingSubmission({ supabase, actor }: Ctx, submissionId: string) {
    const { classroom } = await requireTeacherOfSubmission(supabase, actor, submissionId);
    const me = requireTeacher(actor);
    const role = classroom.teacher_id === me.userId ? 'primary' : (classroom.teachers || []).find((t) => t.teacher_id === me.userId)?.role;
    if (role === 'researcher') throw FORBIDDEN();
    const { data: sub, error: readError } = await supabase.from('submissions').select('id, assignment_id, status').eq('id', submissionId).maybeSingle();
    if (readError) throw toDatabaseError(readError, 'submissions');
    if (!sub) return;
    if (isHandedIn(sub as Pick<Submission, 'status'>)) throw new HttpError(409, 'นักเรียนส่งงานแล้ว จึงยกเลิกไม่ได้');
    const { error: answersError } = await supabase.from('submission_answers').delete().eq('submission_id', submissionId);
    if (answersError) throw toDatabaseError(answersError, 'submission_answers');
    // Only while still not handed in: a student handing in at this moment keeps their work.
    const { error } = await supabase.from('submissions').delete().eq('id', submissionId).eq('status', 'pending');
    if (error) throw toDatabaseError(error, 'submissions');
    const assignmentId = sub.assignment_id as string;
    after(() => signalClassroom(classroom.id, { type: 'submission', assignmentId }));
  },
};

export type DataActionName = keyof typeof dataActions;

/** Body text of an assignment's timeline post (also what LINE announces). */
async function submissionWithClassroom(supabase: Supabase, submissionId: string) {
  // One round trip: the submission with its assignment's classroom (only what access checks need).
  const { data } = await supabase
    .from('submissions')
    .select('id, assignment_id, student_id, assignment:assignments(classroom:classrooms(id, teacher_id, teachers))')
    .eq('id', submissionId)
    .maybeSingle();
  if (!data) throw new HttpError(404, 'ไม่พบงานที่ส่ง');
  const { assignment, ...submission } = data as unknown as {
    id: string;
    assignment_id: string;
    student_id: string;
    assignment: { classroom: Classroom | null } | null;
  };
  const classroom = assignment?.classroom;
  if (!classroom) throw new HttpError(404, 'ไม่พบห้องเรียน');
  return { submission, classroom };
}

const REOPEN_MIGRATION_MESSAGE =
  'ฐานข้อมูลยังไม่รองรับการเปิดให้แก้ไข/ส่งงานรายคน — รัน supabase_submission_reopen_until_update.sql ใน Supabase SQL Editor';
/** Longest per-student window the teacher can give in one go. */
const REOPEN_MAX_MS = 30 * 24 * 60 * 60 * 1000;

/** The teacher's per-student time limit: null (no limit) or an ISO time in the future. */
function parseReopenUntil(value: unknown): string | null {
  if (value == null || value === '') return null;
  const ms = typeof value === 'string' ? new Date(value).getTime() : NaN;
  if (Number.isNaN(ms)) throw new HttpError(400, 'เวลาที่ให้ส่งไม่ถูกต้อง');
  if (ms <= Date.now()) throw new HttpError(400, 'กรุณาเลือกเวลาที่อยู่ในอนาคต');
  if (ms > Date.now() + REOPEN_MAX_MS) throw new HttpError(400, 'ให้เวลาได้ไม่เกิน 30 วัน');
  return new Date(ms).toISOString();
}

/**
 * Writes the per-student permission. Databases without reopen_until still take
 * a permission with no limit; a time limit needs the column.
 */
async function writeReopen(
  supabase: Supabase,
  reopenedAt: string | null,
  reopenUntil: string | null,
  where: (query: ReturnType<ReturnType<Supabase['from']>['update']>) => PromiseLike<{ error: { message: string } | null }>
) {
  let { error } = await where(supabase.from('submissions').update({ reopened_at: reopenedAt, reopen_until: reopenUntil }));
  if (error?.message.includes('reopen_until') && !reopenUntil) {
    ({ error } = await where(supabase.from('submissions').update({ reopened_at: reopenedAt })));
  }
  if (error) {
    if (/reopen(ed_at|_until)/.test(error.message)) throw new HttpError(503, REOPEN_MIGRATION_MESSAGE);
    throw toDatabaseError(error, 'submissions');
  }
}

async function requireTeacherOfSubmission(supabase: Supabase, actor: Actor | null, submissionId: string) {
  const me = requireTeacher(actor);
  const found = await submissionWithClassroom(supabase, submissionId);
  if (!isTeacherOf(found.classroom, me.userId)) throw FORBIDDEN();
  return found;
}

async function requireSubmissionAccess(supabase: Supabase, actor: Actor | null, submissionId: string) {
  if (!actor) throw UNAUTHORIZED();
  const found = await submissionWithClassroom(supabase, submissionId);
  if (actor.kind === 'teacher' ? !isTeacherOf(found.classroom, actor.userId) : !actor.keys.includes(found.submission.student_id)) throw FORBIDDEN();
  return found;
}

async function teacherInstitution(supabase: Supabase, teacherId: string): Promise<string> {
  const { data } = await supabase.from('users').select('institution').eq('id', teacherId).maybeSingle();
  return data?.institution?.trim() || '';
}

/** Finds the course and role a co-teacher invite code stands for (checks every course; codes are HMACs). */
async function resolveTeacherInvite(supabase: Supabase, rawCode: string) {
  const code = normalizeInviteCode(rawCode);
  if (code.length !== 12) return null;
  const { data: courses } = await supabase.from('courses').select('id, code, name, description, semester, year_ce, academic_year, indicators, primary_teacher_id, teachers');
  for (const course of (courses || []) as Course[]) {
    for (const role of ['assistant', 'researcher'] as const) {
      if (teacherInviteCode(course.id, role) === code) return { course, role };
    }
  }
  return null;
}

export function createDataContext(actor: Actor | null): Ctx {
  return { supabase: createServiceSupabaseClient(), actor };
}
