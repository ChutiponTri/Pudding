import 'server-only';
import { institutionKey } from '@/lib/data/thaiInstitutions';
import type { Actor } from '@/lib/auth/actor';
import type { createServiceSupabaseClient } from '@/lib/supabase/server';
import type { Classroom, User } from '@/types/database';
import { HttpError } from '@/lib/server/access';

type Supabase = ReturnType<typeof createServiceSupabaseClient>;

export type ProxyStudent = Pick<User, 'id' | 'first_name' | 'last_name'> &
  Partial<Pick<User, 'line_uid' | 'student_id' | 'avatar_url' | 'institution'>>;

const normalizeSchool = institutionKey;
const normalizeNumber = (value?: string | null) => (value || '').replace(/\s+/g, '').toLowerCase();
/** Classmates are found by the last digits of their student number. */
export const PROXY_MATCH_DIGITS = 3;
const IN_CHUNK = 150;

/**
 * The classmate a student acts for on a borrowed phone (their own phone is
 * broken or out of battery). Only the classroom's admitted students are
 * searched, so the classmate is in the same class, subject and semester; they
 * must also be registered at the same school as the phone's owner. Matching
 * uses the last PROXY_MATCH_DIGITS digits of the student number; when two
 * classmates share them, the full number decides. The caller must already
 * have checked that the owner is an admitted student of this classroom.
 */
export async function resolveProxyStudent(
  supabase: Supabase,
  actor: Extract<Actor, { kind: 'student' }>,
  classroom: Classroom,
  rawStudentNumber: unknown
): Promise<ProxyStudent> {
  const typed = normalizeNumber(typeof rawStudentNumber === 'string' ? rawStudentNumber : '');
  if (!typed) throw new HttpError(400, 'กรุณากรอกรหัสนักเรียนของเพื่อน');
  if (typed.length < PROXY_MATCH_DIGITS) throw new HttpError(400, `กรุณากรอกรหัสนักเรียนของเพื่อนอย่างน้อย ${PROXY_MATCH_DIGITS} ตัวท้าย`);
  const suffix = typed.slice(-PROXY_MATCH_DIGITS);

  const { data: owner } = await supabase.from('users').select('id, student_id, institution').eq('id', actor.userId).maybeSingle();
  const ownerSchool = normalizeSchool(owner?.institution);
  if (!ownerSchool) throw new HttpError(409, 'กรุณาระบุสถานศึกษาในข้อมูลส่วนตัวของคุณก่อนส่งงานแทนเพื่อน');

  // Everyone admitted to this classroom: the roster plus students admitted through the join table only.
  const { data: links } = await supabase.from('classroom_students').select('student_id, status').eq('classroom_id', classroom.id);
  const memberIds = [
    ...new Set([
      ...(classroom.students || []).flatMap((s) => (s ? [s.id, s.line_uid] : [])),
      ...(links || []).filter((l) => l.status !== 'pending_approval').map((l) => l.student_id as string),
    ].filter((id): id is string => !!id && !actor.keys.includes(id))),
  ];
  const members: ProxyStudent[] = [];
  for (let i = 0; i < memberIds.length; i += IN_CHUNK) {
    const part = memberIds.slice(i, i + IN_CHUNK);
    const quoted = part.map((id) => `"${id.replace(/["\\]/g, '')}"`).join(',');
    const { data } = await supabase
      .from('users')
      .select('id, first_name, last_name, line_uid, student_id, avatar_url, institution')
      .eq('role', 'student')
      .or(`id.in.(${quoted}),line_uid.in.(${quoted})`);
    members.push(...((data || []) as ProxyStudent[]));
  }

  const candidates = [...new Map(members.map((u) => [u.id, u])).values()].filter(
    (u) =>
      !actor.keys.includes(u.id) &&
      !(u.line_uid && actor.keys.includes(u.line_uid)) &&
      normalizeSchool(u.institution) === ownerSchool &&
      normalizeNumber(u.student_id).endsWith(suffix)
  );
  // Several share the last digits: the full number picks one.
  const matches = candidates.length > 1 ? candidates.filter((u) => normalizeNumber(u.student_id) === typed) : candidates;

  if (!matches.length && candidates.length > 1) {
    throw new HttpError(409, `มีเพื่อนในห้องนี้ ${candidates.length} คนที่รหัส ${PROXY_MATCH_DIGITS} ตัวท้ายเป็น ${suffix} กรุณากรอกรหัสนักเรียนแบบเต็ม`);
  }
  if (!matches.length) {
    const ownNumber = normalizeNumber(owner?.student_id);
    if (ownNumber && (ownNumber === typed || (typed.length === PROXY_MATCH_DIGITS && ownNumber.endsWith(suffix)))) {
      throw new HttpError(400, 'นี่คือรหัสนักเรียนของคุณเอง');
    }
    throw new HttpError(404, 'ไม่พบเพื่อนรหัสนี้ในห้องเรียนนี้ (ต้องเรียนห้องและวิชาเดียวกันในภาคเรียนนี้ และอยู่โรงเรียนเดียวกัน)');
  }
  const match = matches[0];
  if (!match.first_name?.trim() || !match.last_name?.trim()) {
    throw new HttpError(409, 'เพื่อนคนนี้ยังไม่ได้ลงทะเบียนชื่อ-นามสกุลในระบบ');
  }
  return match;
}
