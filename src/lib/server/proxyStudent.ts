import 'server-only';
import type { Actor } from '@/lib/auth/actor';
import type { createServiceSupabaseClient } from '@/lib/supabase/server';
import type { Classroom, User } from '@/types/database';
import { HttpError } from '@/lib/server/access';

type Supabase = ReturnType<typeof createServiceSupabaseClient>;

export type ProxyStudent = Pick<User, 'id' | 'first_name' | 'last_name'> &
  Partial<Pick<User, 'line_uid' | 'student_id' | 'avatar_url' | 'institution'>>;

const normalizeSchool = (value?: string | null) => (value || '').trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * The classmate a student acts for on a borrowed phone (their own phone is
 * broken or out of battery). Allowed only when the classmate is an admitted
 * student of the same classroom (same subject) and registered at the same
 * school as the phone's owner. The caller must already have checked that the
 * owner is an admitted student of this classroom.
 */
export async function resolveProxyStudent(
  supabase: Supabase,
  actor: Extract<Actor, { kind: 'student' }>,
  classroom: Classroom,
  rawStudentNumber: unknown
): Promise<ProxyStudent> {
  const studentNumber = typeof rawStudentNumber === 'string' ? rawStudentNumber.trim() : '';
  if (!studentNumber) throw new HttpError(400, 'กรุณากรอกรหัสนักเรียนของเพื่อน');

  const [{ data: owner }, { data: candidates }] = await Promise.all([
    supabase.from('users').select('id, student_id, institution').eq('id', actor.userId).maybeSingle(),
    supabase
      .from('users')
      .select('id, first_name, last_name, line_uid, student_id, avatar_url, institution')
      .eq('student_id', studentNumber)
      .eq('role', 'student'),
  ]);
  const ownerSchool = normalizeSchool(owner?.institution);
  if (!ownerSchool) throw new HttpError(409, 'กรุณาระบุสถานศึกษาในข้อมูลส่วนตัวของคุณก่อนส่งงานแทนเพื่อน');
  if (owner?.student_id?.trim() === studentNumber) throw new HttpError(400, 'นี่คือรหัสนักเรียนของคุณเอง');

  const roster = classroom.students || [];
  const sameSchool = ((candidates || []) as ProxyStudent[]).filter(
    (user) => !actor.keys.includes(user.id) && normalizeSchool(user.institution) === ownerSchool
  );
  const inRoster = (user: ProxyStudent) =>
    roster.some((s) => s && (s.id === user.id || (!!user.line_uid && (s.id === user.line_uid || s.line_uid === user.line_uid))));
  let match = sameSchool.find(inRoster);
  if (!match && sameSchool.length) {
    // Students admitted through the join table only.
    const { data: links } = await supabase
      .from('classroom_students')
      .select('student_id, status')
      .eq('classroom_id', classroom.id)
      .in('student_id', sameSchool.flatMap((u) => [u.id, u.line_uid].filter(Boolean) as string[]));
    const admitted = new Set((links || []).filter((l) => l.status !== 'pending_approval').map((l) => l.student_id));
    match = sameSchool.find((u) => admitted.has(u.id) || (!!u.line_uid && admitted.has(u.line_uid)));
  }
  if (!match) {
    throw new HttpError(404, 'ไม่พบเพื่อนรหัสนี้ในห้องเรียนนี้ (ต้องเป็นนักเรียนโรงเรียนเดียวกันและเรียนวิชาเดียวกัน)');
  }
  if (!match.first_name?.trim() || !match.last_name?.trim()) {
    throw new HttpError(409, 'เพื่อนคนนี้ยังไม่ได้ลงทะเบียนชื่อ-นามสกุลในระบบ');
  }
  return match;
}
