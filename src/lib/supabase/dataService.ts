import type { SupabaseClient } from '@supabase/supabase-js';
import {
  Assignment,
  Classroom,
  Course,
  CourseLearningIndicator,
  LearningIndicator,
  Question,
  Submission,
  SubmissionAnswer,
  SubmissionEvent,
  SubmissionOverrideStatus,
  TeacherGradeRecord,
  TeacherRole,
  User,
} from '@/types/database';
import { createClient } from './client';
import { parseAcademicPeriod } from '@/lib/utils/academicYear';
import { formatDateTime, SCHOOL_TIME_ZONE } from '@/lib/utils/datetime';

/**
 * Browser data access. Supabase is the only source of truth: every read is
 * scoped on the server (by teacher, classroom or student) so pages download
 * only what they show, and every failed write throws instead of pretending.
 */

/** Columns the UI needs from users; avoids shipping whole rows. */
const USER_FIELDS = 'id, first_name, last_name, student_id, institution, avatar_url, email, line_uid, role, is_line_connected';

/** PostgREST `in.(…)` lists live in the URL, so keep each request reasonably small. */
const IN_CHUNK = 150;

let registeredInstitutionsCache: { value: string[]; expiresAt: number } | null = null;
let registeredInstitutionsRequest: Promise<string[]> | null = null;

function chunk<T>(items: T[], size = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Quote a value for a PostgREST `in.(…)` / `or=(…)` filter. */
function pgValue(value: string): string {
  return `"${value.replace(/["\\]/g, '')}"`;
}

/**
 * Value for a JSONB `contains` filter. supabase-js turns a JS array into a
 * Postgres array literal, which JSONB columns reject, so send JSON text.
 */
function jsonArray(item: Record<string, string>): string {
  return JSON.stringify([item]);
}

/** Strip characters that would break an `or=(…ilike…)` filter. */
function searchTerm(value: string): string {
  return value.replace(/[,()%*\\"]/g, ' ').trim();
}

/**
 * Turns a Supabase error into a readable message. A missing column means
 * the database is behind the app (the latest migration has not been run).
 */
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

function isTeacherOf(record: { teacher_id?: string; primary_teacher_id?: string; teachers?: { teacher_id: string }[] }, teacherId: string) {
  return record.teacher_id === teacherId || record.primary_teacher_id === teacherId || !!record.teachers?.some((t) => t.teacher_id === teacherId);
}

/** Load users referenced by id, LINE id or school number, in a few batched requests. */
async function fetchUsersByKeys(supabase: SupabaseClient, keys: Array<string | undefined | null>): Promise<Map<string, User>> {
  const unique = [...new Set(keys.filter((k): k is string => !!k && !!k.trim()))];
  const map = new Map<string, User>();
  if (unique.length === 0) return map;

  const results = await Promise.all(
    chunk(unique).map((part) => {
      const list = part.map(pgValue).join(',');
      return supabase
        .from('users')
        .select(USER_FIELDS)
        .or(`id.in.(${list}),line_uid.in.(${list}),student_id.in.(${list})`);
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

/** What roster subscribers receive. */
export type ClassroomChangeEvent = {
  type?: 'classrooms' | 'classroom_students';
  eventType?: string;
  detail?: {
    classroomId?: string;
    studentId?: string;
    student?: Partial<User>;
    autoAdmit?: boolean;
    action?: string;
    source?: string;
  };
  payload?: unknown;
};

type RowChange<T> = { eventType?: string; new?: Partial<T>; old?: Partial<T> };

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
 * Only users referenced by these classrooms are fetched.
 */
async function hydrateClassrooms(supabase: SupabaseClient, rows: Classroom[]): Promise<Classroom[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((c) => c.id);

  const linkResults = await Promise.all(
    chunk(ids).map((part) =>
      supabase.from('classroom_students').select('classroom_id, student_id, status').in('classroom_id', part)
    )
  );
  const links = linkResults.flatMap((r) => (r.data || []) as EnrollmentLink[]);

  const keys: string[] = links.map((l) => l.student_id);
  for (const cls of rows) {
    for (const s of [...(cls.students || []), ...(cls.pending_students || [])]) {
      keys.push(s.id, s.line_uid || '', s.student_id || '');
    }
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

/** Make sure a teacher row exists before inserting rows that reference it. */
async function ensureTeacherUser(
  supabase: SupabaseClient,
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
async function findClassroomsContainingStudent(supabase: SupabaseClient, keys: string[]): Promise<Classroom[]> {
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

function notifyLocal(eventName: string, detail: unknown) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(eventName, { detail }));
  try {
    const bc = new BroadcastChannel('pudding_classroom_sync');
    bc.postMessage({ type: 'LOCAL_SYNC', detail });
    bc.close();
  } catch {}
}

function broadcastRealtime(event: string, payload: Record<string, unknown>) {
  try {
    const channel = createClient().channel('pudding_realtime_broadcast');
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        channel.send({ type: 'broadcast', event, payload });
        setTimeout(() => createClient().removeChannel(channel), 1000);
      }
    });
  } catch {}
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `Request failed (${res.status})`);
  return json as T;
}

export const dataService = {
  // ==========================================
  // USERS
  // ==========================================
  async syncLineStudentUser(student: {
    line_uid: string;
    name: string;
    first_name?: string;
    last_name?: string;
    avatar?: string | null;
    student_id?: string;
    institution?: string;
    email?: string | null;
  }): Promise<User> {
    const supabase = createClient();
    const lineUid = student.line_uid.trim();
    let firstName = student.first_name?.trim() || '';
    let lastName = student.last_name?.trim() || '';
    let studentCode: string | null = student.student_id?.trim() || null;
    let institution: string | null = student.institution?.trim() || null;

    if (!firstName) {
      const names = student.name.trim().split(' ');
      firstName = names[0] || 'นักเรียน';
      lastName = names.slice(1).join(' ');
    }

    // LINE userId is the stable identity across LIFF in LINE and an external
    // browser; reuse an older row found by line_uid before creating anything.
    const { data: existingRows, error: readError } = await supabase
      .from('users')
      .select('*')
      .or(`id.eq.${pgValue(lineUid)},line_uid.eq.${pgValue(lineUid)}`)
      .limit(2);
    if (readError) throw toDatabaseError(readError, 'users');
    const existing = (existingRows || []).find((u) => u.id === lineUid) || existingRows?.[0];

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
    };
  },

  async updateStudentProfile(
    userId: string,
    data: { first_name: string; last_name: string; student_id: string; institution: string; email?: string | null }
  ): Promise<boolean> {
    const supabase = createClient();
    const fields = {
      first_name: data.first_name.trim(),
      last_name: data.last_name.trim(),
      student_id: data.student_id.trim(),
      institution: data.institution.trim(),
      email: data.email?.trim() || null,
    };

    const { error } = await supabase.from('users').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', userId);
    if (error) {
      console.error('updateStudentProfile error:', error);
      return false;
    }

    // Keep the roster snapshots of the student's classrooms in step.
    const classrooms = await findClassroomsContainingStudent(supabase, [userId]);
    const patch = (s: User) => (s.id === userId || s.line_uid === userId ? { ...s, ...fields, email: fields.email || undefined } : s);
    await Promise.all(
      classrooms.map((cls) =>
        supabase
          .from('classrooms')
          .update({ students: (cls.students || []).map(patch), pending_students: (cls.pending_students || []).map(patch) })
          .eq('id', cls.id)
      )
    );

    notifyLocal('pudding_student_enrolled', { studentId: userId, student: { id: userId, role: 'student', ...fields } });
    return true;
  },

  async updateTeacherProfile(userId: string, profile: { first_name: string; last_name: string; institution: string }): Promise<boolean> {
    const fn = profile.first_name.trim();
    const ln = profile.last_name.trim();
    const inst = profile.institution.trim();
    if (!fn || !ln || !inst) return false;
    const { error } = await createClient()
      .from('users')
      .update({ first_name: fn, last_name: ln, institution: inst, updated_at: new Date().toISOString() })
      .eq('id', userId);
    if (error) throw toDatabaseError(error, 'users');
    registeredInstitutionsCache = null;
    return true;
  },

  async syncClerkUser(clerkUser: {
    id: string;
    firstName?: string | null;
    lastName?: string | null;
    imageUrl?: string | null;
    email?: string | null;
    institution?: string | null;
  }): Promise<User> {
    const supabase = createClient();
    const { data: existing } = await supabase.from('users').select('first_name, last_name, institution').eq('id', clerkUser.id).maybeSingle();

    const record: Record<string, unknown> = {
      id: clerkUser.id,
      // Names edited in the app win over Clerk's profile.
      first_name: existing?.first_name || clerkUser.firstName || 'คุณครู',
      last_name: existing?.last_name || clerkUser.lastName || '',
      avatar_url: clerkUser.imageUrl || null,
      email: clerkUser.email || '',
      role: 'teacher',
      institution: clerkUser.institution || existing?.institution || null,
      updated_at: new Date().toISOString(),
    };

    let { data, error } = await supabase.from('users').upsert({ ...record, clerk_id: clerkUser.id }).select().single();
    // Older databases have no clerk_id column.
    if (error && error.message.includes('clerk_id')) {
      ({ data, error } = await supabase.from('users').upsert(record).select().single());
    }
    if (error) throw toDatabaseError(error, 'users');
    return data as User;
  },

  async getUserById(id: string): Promise<User | null> {
    const { data, error } = await createClient().from('users').select('*').eq('id', id).maybeSingle();
    if (error) {
      console.warn('getUserById error:', error.message);
      return null;
    }
    return (data as User) || null;
  },

  async searchStudentsByInstitution(query?: string, institution?: string): Promise<User[]> {
    let req = createClient().from('users').select(USER_FIELDS).eq('role', 'student');
    if (institution) req = req.eq('institution', institution);
    const q = searchTerm(query || '');
    if (q) req = req.or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,student_id.ilike.%${q}%,email.ilike.%${q}%`);
    const { data, error } = await req.order('first_name').limit(50);
    if (error) {
      console.warn('searchStudentsByInstitution error:', error.message);
      return [];
    }
    return (data || []) as User[];
  },

  async searchTeachers(query?: string, institution?: string): Promise<User[]> {
    let req = createClient().from('users').select(USER_FIELDS).eq('role', 'teacher');
    const q = searchTerm(query || '');
    if (q) req = req.or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%,institution.ilike.%${q}%`);
    const { data, error } = await req.order('first_name').limit(50);
    if (error) {
      console.warn('searchTeachers error:', error.message);
      return [];
    }
    const list = (data || []) as User[];
    if (institution) {
      list.sort((a, b) => Number(b.institution === institution) - Number(a.institution === institution));
    }
    return list;
  },

  async getRegisteredInstitutions(): Promise<string[]> {
    if (registeredInstitutionsCache && registeredInstitutionsCache.expiresAt > Date.now()) {
      return registeredInstitutionsCache.value;
    }
    if (registeredInstitutionsRequest) return registeredInstitutionsRequest;

    registeredInstitutionsRequest = (async () => {
      const { data, error } = await createClient().from('users').select('institution').not('institution', 'is', null).neq('institution', '');
      if (error) {
        console.warn('getRegisteredInstitutions error:', error.message);
        return [];
      }
      const value = [...new Set((data || []).map((d: { institution: string }) => d.institution.trim()).filter(Boolean))];
      registeredInstitutionsCache = { value, expiresAt: Date.now() + 5 * 60 * 1000 };
      return value;
    })();

    try {
      return await registeredInstitutionsRequest;
    } finally {
      registeredInstitutionsRequest = null;
    }
  },

  // ==============================================================================
  // COURSES
  // ==============================================================================
  async getCourses(teacherId?: string): Promise<Course[]> {
    const supabase = createClient();
    if (!teacherId) {
      const { data, error } = await supabase.from('courses').select('*').order('created_at', { ascending: false });
      if (error) throw toDatabaseError(error, 'courses');
      return (data || []) as Course[];
    }
    const [own, shared] = await Promise.all([
      supabase.from('courses').select('*').eq('primary_teacher_id', teacherId),
      supabase.from('courses').select('*').contains('teachers', jsonArray({ teacher_id: teacherId })),
    ]);
    if (own.error || shared.error) throw toDatabaseError((own.error || shared.error)!, 'courses');
    return uniqueById([...(own.data || []), ...(shared.data || [])] as Course[]).sort(byCreatedDesc);
  },

  async getCourseById(id: string): Promise<Course | null> {
    const { data, error } = await createClient().from('courses').select('*').eq('id', id).maybeSingle();
    if (error) throw toDatabaseError(error, 'courses');
    return (data as Course) || null;
  },

  async createCourse(data: Omit<Course, 'id' | 'created_at'>): Promise<Course> {
    const supabase = createClient();
    const newCourse: Course = { ...data, id: `course-${Date.now()}`, created_at: new Date().toISOString() };
    await ensureTeacherUser(supabase, newCourse.primary_teacher_id, newCourse.teachers);
    const { error } = await supabase.from('courses').insert(newCourse);
    if (error) throw toDatabaseError(error, 'courses');
    return newCourse;
  },

  async updateCourse(id: string, data: Partial<Course>): Promise<Course | null> {
    const supabase = createClient();
    const { data: updated, error } = await supabase.from('courses').update(data).eq('id', id).select().maybeSingle();
    if (error) throw toDatabaseError(error, 'courses');

    // Co-teachers apply to every section of the course.
    if (data.teachers) {
      const { error: clsError } = await supabase.from('classrooms').update({ teachers: data.teachers }).eq('course_id', id);
      if (clsError) console.warn('Sync teachers to classrooms error:', clsError.message);
    }
    return (updated as Course) || null;
  },

  async deleteCourse(id: string): Promise<void> {
    const { error } = await createClient().from('courses').delete().eq('id', id);
    if (error) throw toDatabaseError(error, 'courses');
  },

  /** Indicators the teacher has used in any of their courses, for quick reuse. */
  async getSavedTeacherIndicators(teacherId?: string): Promise<CourseLearningIndicator[]> {
    if (!teacherId) return [];
    const courses = await this.getCourses(teacherId);
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

  async updateCourseIndicators(courseId: string, indicators: CourseLearningIndicator[]): Promise<Course | null> {
    return this.updateCourse(courseId, { indicators });
  },

  // ==============================================================================
  // CLASSROOMS
  // ==============================================================================
  /**
   * A teacher's classrooms (owned or co-taught). Rosters are filled in from the
   * users table unless `withRoster: false` (lists that only show class names).
   */
  async getClassrooms(teacherId?: string, options: { withRoster?: boolean } = {}): Promise<Classroom[]> {
    const supabase = createClient();
    let rows: Classroom[];
    if (teacherId) {
      const [own, shared] = await Promise.all([
        supabase.from('classrooms').select('*').eq('teacher_id', teacherId),
        supabase.from('classrooms').select('*').contains('teachers', jsonArray({ teacher_id: teacherId })),
      ]);
      if (own.error || shared.error) throw toDatabaseError((own.error || shared.error)!, 'classrooms');
      rows = uniqueById([...(own.data || []), ...(shared.data || [])] as Classroom[]).sort(byCreatedDesc);
    } else {
      const { data, error } = await supabase.from('classrooms').select('*').order('created_at', { ascending: false });
      if (error) throw toDatabaseError(error, 'classrooms');
      rows = (data || []) as Classroom[];
    }
    return options.withRoster === false ? rows : hydrateClassrooms(supabase, rows);
  },

  /** Classrooms a student belongs to or has asked to join. */
  async getStudentClassrooms(student: { id: string; line_uid?: string }): Promise<Classroom[]> {
    const supabase = createClient();
    const keys = [student.id, student.line_uid || ''].filter(Boolean);
    const [fromRoster, links] = await Promise.all([
      findClassroomsContainingStudent(supabase, keys),
      supabase.from('classroom_students').select('classroom_id').in('student_id', keys),
    ]);
    const known = new Set(fromRoster.map((c) => c.id));
    const extraIds = [...new Set((links.data || []).map((l: { classroom_id: string }) => l.classroom_id))].filter((id) => !known.has(id));
    let extra: Classroom[] = [];
    if (extraIds.length) {
      const { data } = await supabase.from('classrooms').select('*').in('id', extraIds);
      extra = (data || []) as Classroom[];
    }
    return hydrateClassrooms(supabase, [...fromRoster, ...extra].sort(byCreatedDesc));
  },

  async findClassroomByInviteCode(code: string): Promise<Classroom | null> {
    const supabase = createClient();
    const { data, error } = await supabase.from('classrooms').select('*').ilike('invite_code', searchTerm(code)).limit(1).maybeSingle();
    if (error || !data) return null;
    const [hydrated] = await hydrateClassrooms(supabase, [data as Classroom]);
    return hydrated;
  },

  async getClassroomRoster(classroomId: string): Promise<{ classroom: Classroom | null; students: User[]; pending_students: User[] }> {
    const supabase = createClient();
    const { data, error } = await supabase.from('classrooms').select('*').eq('id', classroomId).maybeSingle();
    if (error) throw toDatabaseError(error, 'classrooms');
    if (!data) return { classroom: null, students: [], pending_students: [] };
    const [classroom] = await hydrateClassrooms(supabase, [data as Classroom]);
    return { classroom, students: classroom.students || [], pending_students: classroom.pending_students || [] };
  },

  async getClassroomById(id: string): Promise<Classroom | null> {
    return (await this.getClassroomRoster(id)).classroom;
  },

  async createClassroom(data: Omit<Classroom, 'id' | 'created_at' | 'student_count' | 'students'>): Promise<Classroom> {
    const supabase = createClient();
    const inviteCode = `PD-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const newClassroom: Classroom = {
      ...data,
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

  async updateClassroom(id: string, data: Partial<Classroom>): Promise<Classroom | null> {
    const { data: updated, error } = await createClient().from('classrooms').update(data).eq('id', id).select().maybeSingle();
    if (error) throw toDatabaseError(error, 'classrooms');
    return (updated as Classroom) || null;
  },

  async deleteClassroom(id: string): Promise<void> {
    const { error } = await createClient().from('classrooms').delete().eq('id', id);
    if (error) throw toDatabaseError(error, 'classrooms');
  },

  async addStudentToClassroom(
    classroomId: string,
    studentData: Omit<User, 'id' | 'role'> & { id?: string },
    options: { autoAdmit?: boolean } = {}
  ): Promise<User> {
    const supabase = createClient();
    const autoAdmit = options.autoAdmit ?? true;
    const studentId =
      studentData.id || studentData.line_uid || (studentData.student_id ? `std_${studentData.student_id.trim()}` : `std-${Date.now()}`);
    const newStudent: User = {
      ...studentData,
      id: studentId,
      role: 'student',
      enrollment_status: autoAdmit ? 'active' : 'pending_approval',
      is_line_connected: Boolean(studentData.line_uid),
    };

    const [userResult, linkResult, classResult] = await Promise.all([
      supabase.from('users').upsert({
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
      }),
      supabase.from('classroom_students').upsert({
        id: `cs_${classroomId}_${newStudent.id}`,
        classroom_id: classroomId,
        student_id: newStudent.id,
        status: autoAdmit ? 'active' : 'pending_approval',
        joined_via: newStudent.line_uid ? 'line_liff' : 'invite_code',
      }),
      supabase.from('classrooms').select('students, pending_students').eq('id', classroomId).maybeSingle(),
    ]);
    if (userResult.error) throw toDatabaseError(userResult.error, 'users');
    if (linkResult.error) throw toDatabaseError(linkResult.error, 'classroom_students');
    if (classResult.error || !classResult.data) throw new Error('ไม่พบห้องเรียนนี้');

    const sameStudent = (s: User) =>
      s.id === newStudent.id ||
      (!!s.line_uid && s.line_uid === newStudent.line_uid) ||
      (!!s.student_id && !!newStudent.student_id && s.student_id.trim() === newStudent.student_id.trim());
    let students = (classResult.data.students || []) as User[];
    let pending = (classResult.data.pending_students || []) as User[];

    if (autoAdmit) {
      students = students.some(sameStudent) ? students.map((s) => (sameStudent(s) ? newStudent : s)) : [newStudent, ...students];
      pending = pending.filter((p) => !sameStudent(p));
    } else if (!students.some(sameStudent)) {
      pending = pending.some(sameStudent) ? pending.map((p) => (sameStudent(p) ? newStudent : p)) : [newStudent, ...pending];
    }

    const { error } = await supabase
      .from('classrooms')
      .update({ students, pending_students: pending, student_count: students.length })
      .eq('id', classroomId);
    if (error) throw toDatabaseError(error, 'classrooms');

    const detail = { classroomId, student: newStudent, autoAdmit };
    broadcastRealtime('student_enrolled', detail);
    notifyLocal('pudding_student_enrolled', detail);
    return newStudent;
  },

  async admitStudentToClassroom(classroomId: string, studentId: string): Promise<boolean> {
    const supabase = createClient();
    const { classroom } = await this.getClassroomRoster(classroomId);
    if (!classroom) return false;
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

    const detail = { classroomId, student, action: 'admitted' };
    broadcastRealtime('student_admitted', detail);
    notifyLocal('pudding_student_admitted', detail);
    return true;
  },

  async rejectStudentFromClassroom(classroomId: string, studentId: string): Promise<boolean> {
    const supabase = createClient();
    const { data, error } = await supabase.from('classrooms').select('pending_students').eq('id', classroomId).maybeSingle();
    if (error || !data) return false;
    const remaining = ((data.pending_students || []) as User[]).filter((s) => s.id !== studentId && s.line_uid !== studentId);

    const [linkResult, classResult] = await Promise.all([
      supabase.from('classroom_students').delete().match({ classroom_id: classroomId, student_id: studentId }),
      supabase.from('classrooms').update({ pending_students: remaining }).eq('id', classroomId),
    ]);
    if (classResult.error) throw toDatabaseError(classResult.error, 'classrooms');
    if (linkResult.error) console.warn('rejectStudentFromClassroom link warning:', linkResult.error.message);

    const detail = { classroomId, studentId, action: 'rejected' };
    broadcastRealtime('student_rejected', detail);
    notifyLocal('pudding_student_rejected', detail);
    return true;
  },

  async removeStudentFromClassroom(classroomId: string, studentId: string): Promise<void> {
    const supabase = createClient();
    const { data, error } = await supabase.from('classrooms').select('students, pending_students').eq('id', classroomId).maybeSingle();
    if (error) throw toDatabaseError(error, 'classrooms');
    const keep = (s: User) => s.id !== studentId && s.line_uid !== studentId;
    const students = ((data?.students || []) as User[]).filter(keep);
    const pending = ((data?.pending_students || []) as User[]).filter(keep);

    const [linkResult, classResult] = await Promise.all([
      supabase.from('classroom_students').delete().match({ classroom_id: classroomId, student_id: studentId }),
      supabase.from('classrooms').update({ students, pending_students: pending, student_count: students.length }).eq('id', classroomId),
    ]);
    if (classResult.error) throw toDatabaseError(classResult.error, 'classrooms');
    if (linkResult.error) console.warn('removeStudentFromClassroom link warning:', linkResult.error.message);
  },

  /**
   * Notify when rosters change. Uses Supabase Realtime, plus a light fallback
   * poll (classroom ids + roster ids only) for projects without Realtime.
   * Pass `classroomIds` so events about other classrooms are ignored.
   */
  subscribeToClassroomChanges(
    arg1?: string | ((event: ClassroomChangeEvent) => void),
    arg2?: (event: ClassroomChangeEvent) => void,
    options: { pollIntervalMs?: number; classroomIds?: () => string[] } = {}
  ) {
    const teacherId = typeof arg1 === 'string' ? arg1 : undefined;
    const onUpdate = typeof arg1 === 'function' ? arg1 : arg2 || (() => {});
    const supabase = createClient();

    const inScope = (classroomId?: string, row?: { teacher_id?: string; teachers?: { teacher_id: string }[] }) => {
      if (!options.classroomIds) return true;
      if (classroomId && options.classroomIds().includes(classroomId)) return true;
      return !!teacherId && !!row && isTeacherOf(row, teacherId);
    };

    const channel = supabase
      .channel(`classrooms_${teacherId || 'student'}_${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'classrooms' }, (change) => {
        const payload = change as RowChange<Classroom>;
        const row = payload.new?.id ? payload.new : payload.old;
        if (inScope(row?.id, row)) onUpdate({ type: 'classrooms', payload });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'classroom_students' }, async (change) => {
        const payload = change as RowChange<EnrollmentLink>;
        const classroomId = payload?.new?.classroom_id || payload?.old?.classroom_id;
        if (!inScope(classroomId)) return;
        let student: User | null = null;
        if (payload?.new?.student_id) {
          const { data } = await supabase.from('users').select(USER_FIELDS).eq('id', payload.new.student_id).maybeSingle();
          student = (data as User) || null;
        }
        const autoAdmit = payload?.new?.status === 'active';
        onUpdate({
          type: 'classroom_students',
          eventType: 'LOCAL_SYNC',
          detail: {
            classroomId,
            student: student || { id: payload?.new?.student_id, first_name: 'นักเรียน', last_name: '' },
            autoAdmit,
            action: payload?.eventType === 'UPDATE' && autoAdmit ? 'admitted' : undefined,
          },
          payload,
        });
      })
      .subscribe();

    const broadcast = supabase.channel('pudding_realtime_broadcast');
    const onBroadcast = (event: { payload?: ClassroomChangeEvent['detail'] }) => {
      if (inScope(event.payload?.classroomId)) onUpdate({ eventType: 'LOCAL_SYNC', detail: event.payload });
    };
    broadcast
      .on('broadcast', { event: 'student_enrolled' }, onBroadcast)
      .on('broadcast', { event: 'student_admitted' }, onBroadcast)
      .on('broadcast', { event: 'student_rejected' }, onBroadcast)
      .subscribe();

    const handleLocalEvent = (e: Event) => onUpdate({ eventType: 'LOCAL_SYNC', detail: (e as CustomEvent).detail });
    let bc: BroadcastChannel | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    if (typeof window !== 'undefined') {
      window.addEventListener('pudding_student_enrolled', handleLocalEvent);
      window.addEventListener('pudding_student_admitted', handleLocalEvent);
      window.addEventListener('pudding_student_rejected', handleLocalEvent);
      try {
        bc = new BroadcastChannel('pudding_classroom_sync');
        bc.onmessage = (event) => onUpdate({ eventType: 'LOCAL_SYNC', detail: event.data?.detail || event.data });
      } catch {}

      // Fallback poll: compares roster ids only, never the full hydrated data.
      if (options.classroomIds) {
        let lastFingerprint = '';
        pollTimer = setInterval(async () => {
          if (document.visibilityState !== 'visible') return;
          const ids = options.classroomIds!();
          if (ids.length === 0) return;
          try {
            const [cls, links] = await Promise.all([
              supabase.from('classrooms').select('id, students, pending_students').in('id', ids),
              supabase.from('classroom_students').select('classroom_id, student_id, status').in('classroom_id', ids),
            ]);
            const fingerprint = JSON.stringify([
              ((cls.data || []) as Classroom[]).map((c) => [c.id, (c.students || []).map((s) => s.id), (c.pending_students || []).map((s) => s.id)]),
              (links.data || []).map((l: EnrollmentLink) => `${l.classroom_id}:${l.student_id}:${l.status}`).sort(),
            ]);
            if (lastFingerprint && fingerprint !== lastFingerprint) {
              onUpdate({ eventType: 'LOCAL_SYNC', detail: { source: 'poll' } });
            }
            lastFingerprint = fingerprint;
          } catch {}
        }, options.pollIntervalMs ?? 15000);
      }
    }

    return () => {
      try {
        supabase.removeChannel(channel);
        supabase.removeChannel(broadcast);
      } catch {}
      if (typeof window !== 'undefined') {
        window.removeEventListener('pudding_student_enrolled', handleLocalEvent);
        window.removeEventListener('pudding_student_admitted', handleLocalEvent);
        window.removeEventListener('pudding_student_rejected', handleLocalEvent);
      }
      try {
        bc?.close();
      } catch {}
      if (pollTimer) clearInterval(pollTimer);
    };
  },

  // ==============================================================================
  // LEARNING INDICATORS
  // ==============================================================================
  async getLearningIndicators(): Promise<LearningIndicator[]> {
    const { data, error } = await createClient().from('learning_indicators').select('*').order('order_index');
    if (error) {
      console.warn('getLearningIndicators error:', error.message);
      return [];
    }
    return (data || []) as LearningIndicator[];
  },

  // ==============================================================================
  // ASSIGNMENTS
  // ==============================================================================
  async getAssignmentsByClassroomIds(classroomIds: string[]): Promise<Assignment[]> {
    const ids = [...new Set(classroomIds.filter(Boolean))];
    if (ids.length === 0) return [];
    const supabase = createClient();
    const results = await Promise.all(chunk(ids).map((part) => supabase.from('assignments').select('*').in('classroom_id', part)));
    const failed = results.find((r) => r.error);
    if (failed?.error) throw toDatabaseError(failed.error, 'assignments');
    return results.flatMap((r) => (r.data || []) as Assignment[]).sort(byCreatedDesc);
  },

  async getAssignmentsByClassroomId(classroomId: string): Promise<Assignment[]> {
    return this.getAssignmentsByClassroomIds([classroomId]);
  },

  async getQuestions(assignmentId: string): Promise<Question[]> {
    const { data, error } = await createClient().from('questions').select('*').eq('assignment_id', assignmentId);
    if (error) throw toDatabaseError(error, 'questions');
    return (data || []) as Question[];
  },

  async getAssignmentById(id: string): Promise<{ assignment: Assignment | null; questions: Question[] }> {
    const supabase = createClient();
    const [assignmentResult, questionsResult] = await Promise.all([
      supabase.from('assignments').select('*').eq('id', id).maybeSingle(),
      supabase.from('questions').select('*').eq('assignment_id', id),
    ]);
    if (assignmentResult.error) throw toDatabaseError(assignmentResult.error, 'assignments');
    return {
      assignment: (assignmentResult.data as Assignment) || null,
      questions: (questionsResult.data || []) as Question[],
    };
  },

  async createAssignment(
    assignmentData: Omit<Assignment, 'id' | 'created_at'>,
    questionsData: Omit<Question, 'id' | 'assignment_id'>[]
  ): Promise<{ assignment: Assignment; questions: Question[] }> {
    const supabase = createClient();
    const id = `assign-${Date.now()}`;
    const newAssignment: Assignment = {
      ...assignmentData,
      id,
      status_override: assignmentData.status_override || 'auto',
      created_at: new Date().toISOString(),
    };
    const newQuestions: Question[] = questionsData.map((q, idx) => ({ ...q, id: `q-${Date.now()}-${idx}`, assignment_id: id }));

    let { error } = await supabase.from('assignments').insert(newAssignment);
    // Databases without the group_name column yet still accept the assignment.
    if (error && error.message?.includes('group_name')) {
      const { group_name: _unused, ...withoutGroup } = newAssignment;
      ({ error } = await supabase.from('assignments').insert(withoutGroup));
    }
    if (error) throw toDatabaseError(error, 'assignments');
    if (newQuestions.length > 0) {
      const { error: qError } = await supabase.from('questions').insert(newQuestions);
      if (qError) {
        await supabase.from('assignments').delete().eq('id', id);
        throw toDatabaseError(qError, 'questions');
      }
    }

    // Timeline post + LINE notification; best effort so creation is not blocked.
    if (typeof window !== 'undefined' && assignmentData.classroom_id) {
      fetch('/api/classrooms/posts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          classroomId: assignmentData.classroom_id,
          activityType: assignmentData.is_exam ? 'exam' : 'assignment',
          body: `${assignmentData.is_exam ? 'ข้อสอบใหม่' : 'งานใหม่'}: ${assignmentData.title} (${assignmentData.is_exam ? 'ปิดรับคำตอบ' : 'กำหนดส่ง'}: ${formatDateTime(assignmentData.due_date, 'th', SCHOOL_TIME_ZONE)})`,
          metadata: { assignmentId: id, dueDate: assignmentData.due_date, groupName: assignmentData.group_name || (assignmentData.is_exam ? 'ข้อสอบ' : 'งานทั่วไป') },
        }),
      }).catch((err) => console.warn('Unable to publish assignment activity:', err));
    }

    return { assignment: newAssignment, questions: newQuestions };
  },

  async updateAssignment(id: string, data: Partial<Omit<Assignment, 'id' | 'created_at'>>): Promise<Assignment | null> {
    const supabase = createClient();
    let { data: updated, error } = await supabase.from('assignments').update(data).eq('id', id).select().maybeSingle();
    if (error && error.message?.includes('group_name')) {
      const { group_name: _unused, ...withoutGroup } = data;
      ({ data: updated, error } = await supabase.from('assignments').update(withoutGroup).eq('id', id).select().maybeSingle());
    }
    if (error) throw toDatabaseError(error, 'assignments');
    return (updated as Assignment) || null;
  },

  async deleteAssignment(id: string): Promise<boolean> {
    const supabase = createClient();
    await Promise.all([
      supabase.from('questions').delete().eq('assignment_id', id),
      supabase.from('submissions').delete().eq('assignment_id', id),
    ]);
    const { error } = await supabase.from('assignments').delete().eq('id', id);
    if (error) throw toDatabaseError(error, 'assignments');
    return true;
  },

  async updateAssignmentDeadlineOverride(
    assignmentId: string,
    override: { status_override: SubmissionOverrideStatus; extended_until?: string }
  ): Promise<Assignment | null> {
    return this.updateAssignment(assignmentId, override);
  },

  // ==============================================================================
  // SUBMISSIONS
  // ==============================================================================
  async submitStudentWork(payload: {
    assignment_id: string;
    student_id: string;
    student_name: string;
    student_first_name?: string;
    student_last_name?: string;
    student_avatar?: string;
    line_uid?: string;
    answers: Array<{ question_id: string; answer_text?: string; file_url?: string }>;
    antiCheating: {
      tab_switch_count: number;
      away_time_seconds: number;
      events: Array<{
        event_type: 'tab_hidden' | 'window_blur' | 'tab_visible' | 'window_focus';
        timestamp: string;
        duration_seconds: number;
        details?: string;
      }>;
    };
  }): Promise<Submission> {
    const firstName = payload.student_first_name || payload.student_name.split(' ')[0] || 'นักเรียน';
    const lastName = payload.student_last_name || payload.student_name.split(' ').slice(1).join(' ');

    const res = await fetch('/api/submissions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        assignment_id: payload.assignment_id,
        student_id: payload.student_id,
        student_name: payload.student_name,
        student_first_name: firstName,
        student_last_name: lastName,
        student_avatar: payload.student_avatar,
        line_uid: payload.line_uid,
        answers: payload.answers,
        antiCheating: payload.antiCheating,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.submission) {
      throw new Error(json?.error || json?.detail || `ส่งงานไม่สำเร็จ (${res.status})`);
    }
    const submission = json.submission as Submission;

    if (typeof window !== 'undefined') {
      try {
        window.dispatchEvent(new CustomEvent('pudding-submission-created', { detail: { submission } }));
        const bc = new BroadcastChannel('pudding-realtime');
        bc.postMessage({ type: 'submission_created', submission });
        bc.close();
      } catch {}
    }
    return submission;
  },

  async getSubmissions(assignmentId: string): Promise<Submission[]> {
    return this.getSubmissionsByAssignmentIds([assignmentId]);
  },

  /**
   * Submissions for many assignments in one or a few requests. The API attaches
   * each student's profile; pass `includeStudents: false` when only counts and
   * scores are needed, and `studentIds` to fetch one student's work.
   */
  async getSubmissionsByAssignmentIds(
    assignmentIds: string[],
    options: { studentIds?: string[]; includeStudents?: boolean } = {}
  ): Promise<Submission[]> {
    const ids = [...new Set(assignmentIds.filter(Boolean))];
    if (ids.length === 0) return [];
    const extra = new URLSearchParams();
    if (options.studentIds?.length) extra.set('studentIds', [...new Set(options.studentIds.filter(Boolean))].join(','));
    if (options.includeStudents === false) extra.set('students', '0');

    const parts = await Promise.all(
      chunk(ids, 80).map((part) => {
        const params = new URLSearchParams(extra);
        params.set('assignmentIds', part.join(','));
        return fetchJson<{ submissions: Submission[] }>(`/api/submissions?${params}`);
      })
    );
    return uniqueById(parts.flatMap((p) => p.submissions || []));
  },

  async getSubmissionEvents(submissionId: string): Promise<SubmissionEvent[]> {
    const { data, error } = await createClient()
      .from('submission_events')
      .select('*')
      .eq('submission_id', submissionId)
      .order('created_at', { ascending: true });
    if (error) throw toDatabaseError(error, 'submission_events');
    return (data || []) as SubmissionEvent[];
  },

  async getSubmissionAnswers(submissionId: string): Promise<Record<string, SubmissionAnswer>> {
    const { data, error } = await createClient().from('submission_answers').select('*').eq('submission_id', submissionId);
    if (error) throw toDatabaseError(error, 'submission_answers');
    const mapped: Record<string, SubmissionAnswer> = {};
    for (const ans of (data || []) as SubmissionAnswer[]) mapped[ans.question_id] = ans;
    return mapped;
  },

  /** All answer rows for many submissions in one query (used by the student LIFF). */
  async getAnswersForSubmissions(submissionIds: string[]): Promise<SubmissionAnswer[]> {
    const ids = [...new Set(submissionIds.filter(Boolean))];
    if (ids.length === 0) return [];
    const supabase = createClient();
    const results = await Promise.all(
      chunk(ids).map((part) =>
        supabase
          .from('submission_answers')
          .select('id, submission_id, question_id, teacher_score, teacher_comment, graded_at')
          .in('submission_id', part)
      )
    );
    return results.flatMap((r) => (r.data || []) as SubmissionAnswer[]);
  },

  async saveTeacherGrade(
    submissionId: string,
    questionId: string,
    teacherScore: number,
    teacherComment: string,
    teacherId: string,
    teacherName: string,
    teacherRole: TeacherRole = 'primary'
  ): Promise<void> {
    const supabase = createClient();
    // Primary teacher or TA gives the official (student-facing) score; a
    // researcher's grade is stored for research only.
    const isOfficial = teacherRole === 'primary' || teacherRole === 'assistant';
    const isResearcher = teacherRole === 'researcher';
    const gradedAt = new Date().toISOString();
    const record: TeacherGradeRecord = {
      teacher_id: teacherId,
      teacher_name: teacherName,
      teacher_role: teacherRole,
      score: teacherScore,
      comment: teacherComment,
      graded_at: gradedAt,
    };

    // The row may not exist yet (e.g. a question the student skipped); reuse it
    // when it does, because UNIQUE(submission_id, question_id) forbids a second.
    const { data: row, error: readError } = await supabase
      .from('submission_answers')
      .select('*')
      .eq('submission_id', submissionId)
      .eq('question_id', questionId)
      .maybeSingle();
    if (readError) throw toDatabaseError(readError, 'submission_answers');
    const existing = (row || {}) as Partial<SubmissionAnswer>;

    const { error: writeError } = await supabase.from('submission_answers').upsert(
      {
        id: existing.id || `ans-${submissionId}-${questionId}`,
        submission_id: submissionId,
        question_id: questionId,
        teacher_score: isOfficial ? teacherScore : existing.teacher_score ?? null,
        teacher_comment: isOfficial ? teacherComment : existing.teacher_comment ?? null,
        co_grades: { ...(existing.co_grades || {}), [teacherId]: record },
        research_grades: isResearcher ? { ...(existing.research_grades || {}), [teacherId]: record } : existing.research_grades || {},
        graded_at: isOfficial ? gradedAt : existing.graded_at ?? null,
        updated_at: gradedAt,
      },
      { onConflict: 'submission_id,question_id' }
    );
    if (writeError) throw toDatabaseError(writeError, 'submission_answers');

    if (isOfficial) {
      // Total = sum of official scores across every answer of this submission.
      const { data: rows, error: totalError } = await supabase.from('submission_answers').select('teacher_score').eq('submission_id', submissionId);
      if (totalError) throw toDatabaseError(totalError, 'submission_answers');
      const total = Math.round((rows || []).reduce((sum, r) => sum + Number(r.teacher_score ?? 0), 0) * 10) / 10;
      const { error: subError } = await supabase.from('submissions').update({ total_score: total }).eq('id', submissionId);
      if (subError) throw toDatabaseError(subError, 'submissions');
    }
  },
};
