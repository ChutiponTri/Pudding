import 'server-only';
import type { createServiceSupabaseClient } from '@/lib/supabase/server';

type Supabase = ReturnType<typeof createServiceSupabaseClient>;

/**
 * Quota for "send test message" to a LINE group (web button and "#pudding test").
 *
 * A push to a group is billed once per group MEMBER, so one test in a class of
 * 40 costs 40 messages of the monthly LINE plan. Limits, over a rolling window:
 *   - per classroom (shared by its co-teachers)    LINE_TEST_LIMIT_PER_CLASSROOM, default 3
 *   - per teacher (across all their classrooms)    LINE_TEST_LIMIT_PER_TEACHER,   default 10
 *   - at least LINE_TEST_COOLDOWN_SECONDS (default 60) between two tests by one teacher
 *
 * Race-safe without a lock: the request records its send first, then counts.
 * If the count (its own row included) is over a limit, it removes its row and
 * refuses. Parallel bursts therefore all fail rather than all pass.
 */
export const LINE_TEST_WINDOW_DAYS = 30;
const intEnv = (name: string, fallback: number) => {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};
export const lineTestLimits = () => ({
  perClassroom: intEnv('LINE_TEST_LIMIT_PER_CLASSROOM', 3),
  perTeacher: intEnv('LINE_TEST_LIMIT_PER_TEACHER', 10),
  cooldownSeconds: intEnv('LINE_TEST_COOLDOWN_SECONDS', 60),
});

export interface LineTestQuota {
  /** Tests left for this classroom right now (the smaller of the two limits). */
  remaining: number;
  perClassroom: number;
  perTeacher: number;
  windowDays: number;
  /** When the oldest counted test drops out of the window (the next slot frees up). */
  nextFreeAt?: string;
}

type SendRow = { id: string; teacher_id: string; classroom_id: string; created_at: string };

export const lineTestWindowStart = () => new Date(Date.now() - LINE_TEST_WINDOW_DAYS * 86_400_000).toISOString();

async function recentSends(supabase: Supabase, teacherId: string, classroomId: string) {
  const since = lineTestWindowStart();
  const columns = 'id, teacher_id, classroom_id, created_at';
  const [byTeacher, byClassroom] = await Promise.all([
    supabase.from('line_test_sends').select(columns).eq('teacher_id', teacherId).gte('created_at', since),
    supabase.from('line_test_sends').select(columns).eq('classroom_id', classroomId).gte('created_at', since),
  ]);
  const error = byTeacher.error || byClassroom.error;
  if (error) throw new Error(`line_test_sends: ${error.message}`);
  return { teacherRows: (byTeacher.data || []) as SendRow[], classroomRows: (byClassroom.data || []) as SendRow[] };
}

function quotaOf(teacherRows: SendRow[], classroomRows: SendRow[]): LineTestQuota {
  const { perClassroom, perTeacher } = lineTestLimits();
  const classroomLeft = Math.max(0, perClassroom - classroomRows.length);
  const teacherLeft = Math.max(0, perTeacher - teacherRows.length);
  const remaining = Math.min(classroomLeft, teacherLeft);
  let nextFreeAt: string | undefined;
  if (remaining === 0) {
    const binding = classroomLeft === 0 ? classroomRows : teacherRows;
    const oldest = binding.map((r) => r.created_at).sort()[0];
    if (oldest) nextFreeAt = new Date(new Date(oldest).getTime() + LINE_TEST_WINDOW_DAYS * 86_400_000).toISOString();
  }
  return { remaining, perClassroom, perTeacher, windowDays: LINE_TEST_WINDOW_DAYS, nextFreeAt };
}

/** Tests left for this teacher in this classroom. null if the quota table cannot be read. */
export async function getLineTestQuota(supabase: Supabase, teacherId: string, classroomId: string): Promise<LineTestQuota | null> {
  try {
    const { teacherRows, classroomRows } = await recentSends(supabase, teacherId, classroomId);
    return quotaOf(teacherRows, classroomRows);
  } catch (error) {
    console.warn('LINE test quota read failed:', error);
    return null;
  }
}

const formatThaiDate = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' }) : '';

export type LineTestReservation =
  | { ok: true; id: string; quota: LineTestQuota }
  | { ok: false; message: string; quota?: LineTestQuota; retryAfterSeconds?: number };

/** Claims one test send. On ok, call releaseLineTestSend(id) if the push then fails. */
export async function reserveLineTestSend(
  supabase: Supabase,
  input: { teacherId: string; classroomId: string; source: 'web' | 'line' }
): Promise<LineTestReservation> {
  const { data: inserted, error } = await supabase
    .from('line_test_sends')
    .insert({ teacher_id: input.teacherId, classroom_id: input.classroomId, source: input.source })
    .select('id, created_at')
    .single();
  if (error || !inserted) {
    // Fail closed: without the log there is no limit.
    console.error('LINE test quota unavailable (run supabase_teacher_approval_update.sql?):', error?.message);
    return { ok: false, message: 'ระบบโควตาทดสอบส่งข้อความยังไม่พร้อม กรุณาติดต่อผู้ดูแลระบบ' };
  }

  let rows: Awaited<ReturnType<typeof recentSends>>;
  try {
    rows = await recentSends(supabase, input.teacherId, input.classroomId);
  } catch (readError) {
    await releaseLineTestSend(supabase, inserted.id);
    console.error('LINE test quota read failed:', readError);
    return { ok: false, message: 'ตรวจโควตาทดสอบส่งข้อความไม่สำเร็จ กรุณาลองใหม่' };
  }
  const { teacherRows, classroomRows } = rows;
  const { perClassroom, perTeacher, cooldownSeconds } = lineTestLimits();
  const mine = new Date(inserted.created_at).getTime();
  const others = (list: SendRow[]) => list.filter((r) => r.id !== inserted.id);
  const refuse = async (message: string, retryAfterSeconds?: number): Promise<LineTestReservation> => {
    await releaseLineTestSend(supabase, inserted.id);
    return { ok: false, message, retryAfterSeconds, quota: quotaOf(others(teacherRows), others(classroomRows)) };
  };

  const recentByMe = others(teacherRows)
    .map((r) => new Date(r.created_at).getTime())
    .filter((t) => Math.abs(mine - t) < cooldownSeconds * 1000);
  if (recentByMe.length) {
    const wait = Math.max(1, Math.ceil((Math.max(...recentByMe) + cooldownSeconds * 1000 - mine) / 1000));
    return refuse(`เพิ่งทดสอบส่งข้อความไป กรุณารออีก ${wait} วินาที`, wait);
  }
  if (classroomRows.length > perClassroom) {
    const quota = quotaOf(others(teacherRows), others(classroomRows));
    return refuse(
      `ห้องนี้ทดสอบส่งข้อความครบ ${perClassroom} ครั้งใน ${LINE_TEST_WINDOW_DAYS} วันแล้ว` +
        (quota.nextFreeAt ? ` ทดสอบได้อีกครั้ง ${formatThaiDate(quota.nextFreeAt)}` : '') +
        ' (ข้อความทดสอบแต่ละครั้งใช้โควตา LINE ตามจำนวนสมาชิกในกลุ่ม)'
    );
  }
  if (teacherRows.length > perTeacher) {
    const quota = quotaOf(others(teacherRows), others(classroomRows));
    return refuse(
      `คุณทดสอบส่งข้อความครบ ${perTeacher} ครั้งใน ${LINE_TEST_WINDOW_DAYS} วันแล้ว` +
        (quota.nextFreeAt ? ` ทดสอบได้อีกครั้ง ${formatThaiDate(quota.nextFreeAt)}` : '')
    );
  }
  return { ok: true, id: inserted.id, quota: quotaOf(teacherRows, classroomRows) };
}

/** Gives a claimed test back (the push failed, or the claim was over the limit). */
export async function releaseLineTestSend(supabase: Supabase, id: string) {
  const { error } = await supabase.from('line_test_sends').delete().eq('id', id);
  if (error) console.warn('LINE test quota release failed:', error.message);
}
