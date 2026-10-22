import 'server-only';
import type { Actor } from '@/lib/auth/actor';
import type { createServiceSupabaseClient } from '@/lib/supabase/server';
import type { Assignment, Classroom, Question, User } from '@/types/database';

type Supabase = ReturnType<typeof createServiceSupabaseClient>;

/** Thrown by access checks; API routes turn it into a JSON error with this status. */
export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const FORBIDDEN = () => new HttpError(403, 'ไม่มีสิทธิ์เข้าถึงข้อมูลนี้');
export const UNAUTHORIZED = () => new HttpError(401, 'กรุณาเข้าสู่ระบบ');

export function isTeacherOf(
  record: { teacher_id?: string | null; primary_teacher_id?: string | null; teachers?: Array<{ teacher_id?: string }> | null },
  teacherId: string
) {
  return record.teacher_id === teacherId || record.primary_teacher_id === teacherId || !!record.teachers?.some((t) => t.teacher_id === teacherId);
}

export function requireTeacher(actor: Actor | null): Extract<Actor, { kind: 'teacher' }> {
  if (!actor) throw UNAUTHORIZED();
  if (actor.kind !== 'teacher') throw FORBIDDEN();
  return actor;
}

export function requireStudent(actor: Actor | null): Extract<Actor, { kind: 'student' }> {
  if (!actor) throw UNAUTHORIZED();
  if (actor.kind !== 'student') throw FORBIDDEN();
  return actor;
}

export type ClassroomRole = 'teacher' | 'student' | 'pending' | null;

/** How the caller relates to a classroom: teaches it, is enrolled, is waiting for approval, or none. */
export async function classroomRole(supabase: Supabase, actor: Actor | null, classroom: Classroom): Promise<ClassroomRole> {
  if (!actor) return null;
  if (actor.kind === 'teacher') return isTeacherOf(classroom, actor.userId) ? 'teacher' : null;
  const mine = (s?: Partial<User> | null) => !!s && (actor.keys.includes(s.id || '') || (!!s.line_uid && actor.keys.includes(s.line_uid)));
  if ((classroom.students || []).some(mine)) return 'student';
  if ((classroom.pending_students || []).some(mine)) return 'pending';
  const { data: link } = await supabase
    .from('classroom_students')
    .select('status')
    .eq('classroom_id', classroom.id)
    .in('student_id', actor.keys)
    .limit(1)
    .maybeSingle();
  if (!link) return null;
  return link.status === 'pending_approval' ? 'pending' : 'student';
}

export async function loadClassroom(supabase: Supabase, classroomId: string): Promise<Classroom | null> {
  if (!classroomId) return null;
  const { data } = await supabase.from('classrooms').select('*').eq('id', classroomId).maybeSingle();
  return (data as Classroom) || null;
}

/** The classroom, if the caller teaches it; otherwise throws. */
export async function requireTeacherOfClassroom(supabase: Supabase, actor: Actor | null, classroomId: string) {
  const teacher = requireTeacher(actor);
  const classroom = await loadClassroom(supabase, classroomId);
  if (!classroom) throw new HttpError(404, 'ไม่พบห้องเรียน');
  if (!isTeacherOf(classroom, teacher.userId)) throw FORBIDDEN();
  return classroom;
}

/** The assignment and its classroom, if the caller teaches that classroom. */
export async function requireTeacherOfAssignment(supabase: Supabase, actor: Actor | null, assignmentId: string) {
  requireTeacher(actor);
  const { data: assignment } = await supabase.from('assignments').select('*').eq('id', assignmentId).maybeSingle();
  if (!assignment) throw new HttpError(404, 'ไม่พบงานนี้');
  const classroom = await requireTeacherOfClassroom(supabase, actor, (assignment as Assignment).classroom_id);
  return { assignment: assignment as Assignment, classroom };
}

/**
 * What a student may see of a classroom: no classmates' details (only their
 * own roster entry) and no LINE connection secrets. Counts stay accurate.
 */
export function classroomForStudent(classroom: Classroom, actor: Extract<Actor, { kind: 'student' }>): Classroom {
  const mine = (s: Partial<User>) => actor.keys.includes(s.id || '') || (!!s.line_uid && actor.keys.includes(s.line_uid));
  const students = classroom.students || [];
  const {
    line_connection_token: _token,
    line_connection_token_expires_at: _expires,
    ...rest
  } = classroom as Classroom & Record<string, unknown>;
  delete (rest as Record<string, unknown>).line_connection_token_hash;
  return {
    ...(rest as Classroom),
    line_group_id: classroom.line_group_id ? 'linked' : undefined,
    students: students.filter(mine),
    pending_students: (classroom.pending_students || []).filter(mine),
    student_count: classroom.student_count ?? students.length,
  };
}

/** Questions as a student receives them: never the answer key or rubric. */
export function questionsForStudent(questions: Question[]): Question[] {
  return questions.map(({ ideal_answer: _answer, rubric_criteria: _rubric, ...rest }) => rest as Question);
}

/** JSON error response for a thrown HttpError (or a generic 500). */
export function errorResponse(error: unknown) {
  if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
  console.error('API error:', error);
  return Response.json({ error: error instanceof Error ? error.message : 'Internal Server Error' }, { status: 500 });
}
