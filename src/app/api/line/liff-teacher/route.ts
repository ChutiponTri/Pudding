import { NextRequest, NextResponse } from 'next/server';
import { getActor } from '@/lib/auth/actor';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { canLinkLine, findBotGroupByRef, LINK_COLUMNS, liffConnectUrl, type LinkClassroom, type ServiceClient } from '@/lib/line/groupLink';
import { guideMessages, inviteMessages, openClassMessages, remindPicture, resultsMessages, workMessages, type LineMessage } from '@/lib/line/teacherCards';
import { missingStudents } from '@/lib/server/workReminder';
import { teacherAccessMessage } from '@/lib/server/teacherProfileGuard';
import { teacherAccessOf } from '@/lib/utils/teacherProfile';
import { isHandedIn } from '@/lib/utils/gradingStatus';
import { rosterFor } from '@/lib/utils/retake';
import { classroomTitle, subjectName } from '@/lib/utils/classroomLabel';
import { getAssignmentWindow } from '@/lib/utils/assignmentWindow';
import type { Assignment, Submission } from '@/types/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The teacher LIFF pages (/liff/teacher), opened from the group menu card
 * with ?g=<group ref>. GET: the classroom linked to that group, for this
 * teacher (owner, co-teacher or TA), plus the data the page shows
 * (?view=work | roster | attendance), all in one request so each page opens
 * with a single round trip. POST: the messages for the page to send into the
 * group with liff.sendMessages (a finished card, or the reminder picture the
 * bot answers).
 * The caller is the LINE account in the LIFF token (see getActor); the page's
 * writes go through the web's own APIs as the same teacher.
 */

type Context = {
  teacherId: string;
  teacher: { first_name?: string | null; last_name?: string | null };
  classroom: LinkClassroom & { course_id?: string | null };
  groupName?: string;
};

async function context(request: NextRequest, ref: string | null): Promise<Context | NextResponse> {
  const actor = await getActor(request, { allowIncompleteProfile: true });
  if (!actor || actor.kind !== 'teacher') {
    return NextResponse.json({ error: 'หน้านี้สำหรับคุณครูเท่านั้น (เข้าสู่ระบบเว็บ Pudding ด้วย LINE บัญชีนี้ก่อน)', code: 'not-teacher' }, { status: 403 });
  }
  if (!ref) return NextResponse.json({ error: 'เปิดหน้านี้จากเมนูครูในกลุ่ม LINE', code: 'no-group' }, { status: 400 });
  const supabase = createServiceSupabaseClient();
  // The teacher's row (approval) and the group, side by side; then the group's classroom.
  const [{ data: teacher }, group] = await Promise.all([
    supabase.from('users').select('first_name, last_name, institution, teacher_approval').eq('id', actor.userId).maybeSingle(),
    findBotGroupByRef(supabase, ref),
  ]);
  const access = teacher ? teacherAccessOf(teacher) : 'incomplete';
  if (access !== 'ok') return NextResponse.json({ error: teacherAccessMessage(access), code: access }, { status: 403 });
  if (!group) return NextResponse.json({ error: 'ไม่พบกลุ่มนี้ (บอทอาจถูกนำออกจากกลุ่มแล้ว) เชิญ Pudding Bot เข้ากลุ่มอีกครั้ง', code: 'no-group' }, { status: 404 });
  const { data: rows } = await supabase.from('classrooms').select(`${LINK_COLUMNS}, course_id`).eq('line_group_id', group.groupId).limit(1);
  const classroom = ((rows || []) as Context['classroom'][])[0];
  if (!classroom) {
    return NextResponse.json({ error: 'กลุ่มนี้ยังไม่ได้เชื่อมกับห้องเรียน', code: 'not-linked', connectUrl: liffConnectUrl(ref) }, { status: 409 });
  }
  if (!canLinkLine(classroom, actor.userId)) {
    return NextResponse.json({ error: 'คุณครูไม่ได้เป็นผู้สอนของห้องเรียนที่เชื่อมกับกลุ่มนี้', code: 'not-staff' }, { status: 403 });
  }
  return { teacherId: actor.userId, teacher: teacher || {}, classroom, groupName: classroom.line_group_name || group.groupName };
}

type RosterStudent = { id: string; first_name: string; last_name: string; student_id?: string; line_uid?: string };

/** The classroom's students (admitted, and waiting for approval) in one query, sorted by student number. */
async function loadRoster(supabase: ServiceClient, classroomId: string) {
  const USER_COLUMNS = 'id, first_name, last_name, student_id, line_uid';
  const { data, error } = await supabase
    .from('classroom_students')
    .select(`status, users(${USER_COLUMNS})`)
    .eq('classroom_id', classroomId);
  let rows = (data || []) as unknown as Array<{ status: string; users: RosterStudent | RosterStudent[] | null }>;
  if (error) {
    // No foreign key PostgREST can follow: the enrolments, then their users.
    const { data: links } = await supabase.from('classroom_students').select('status, student_id').eq('classroom_id', classroomId);
    const ids = (links || []).map((link) => link.student_id as string);
    const { data: users } = ids.length ? await supabase.from('users').select(USER_COLUMNS).in('id', ids) : { data: [] };
    const byId = new Map(((users || []) as RosterStudent[]).map((user) => [user.id, user]));
    rows = (links || []).map((link) => ({ status: link.status as string, users: byId.get(link.student_id as string) || null }));
  }
  const byNumber = (a: RosterStudent, b: RosterStudent) => (a.student_id || '').localeCompare(b.student_id || '', undefined, { numeric: true }) || a.first_name.localeCompare(b.first_name, 'th');
  const pick = (status: string) =>
    rows
      .filter((row) => row.status === status)
      .map((row) => (Array.isArray(row.users) ? row.users[0] : row.users))
      .filter((user): user is RosterStudent => !!user)
      .sort(byNumber);
  return { students: pick('active'), pending: pick('pending_approval') };
}

/**
 * Every work of the classroom with its numbers, worked out here against the
 * real roster (a retake counts only its students): handed in, graded,
 * waiting to be graded, and not handed in yet.
 */
async function loadWork(supabase: ServiceClient, classroomId: string) {
  const [{ data: works }, roster] = await Promise.all([
    supabase.from('assignments').select('*').eq('classroom_id', classroomId).order('created_at', { ascending: false }),
    loadRoster(supabase, classroomId),
  ]);
  const list = (works || []) as Assignment[];
  const { data: subs } = list.length
    ? await supabase.from('submissions').select('assignment_id, student_id, status, total_score').in('assignment_id', list.map((work) => work.id))
    : { data: [] };
  const rows = (subs || []) as Array<{ assignment_id: string; student_id: string; status: Submission['status']; total_score: number | null }>;
  return {
    students: roster.students.length,
    pending: roster.pending.length,
    works: list.map((work) => {
      const takers = rosterFor(work, roster.students);
      const keys = new Set(takers.flatMap((s) => [s.id, s.line_uid].filter(Boolean) as string[]));
      const mine = rows.filter((row) => row.assignment_id === work.id && keys.has(row.student_id));
      const handed = mine.filter((row) => isHandedIn(row)).length;
      const graded = mine.filter((row) => isHandedIn(row) && row.total_score != null).length;
      return { work, total: takers.length, handed, graded, toGrade: handed - graded, missing: Math.max(0, takers.length - handed) };
    }),
  };
}

async function loadAttendance(supabase: ServiceClient, classroomId: string) {
  const [{ data: sessions }, { data: records }, roster] = await Promise.all([
    supabase.from('attendance_sessions').select('*').eq('classroom_id', classroomId).order('starts_at', { ascending: false }).limit(30),
    supabase.from('attendance_records').select('session_id, student_id, status').eq('classroom_id', classroomId),
    loadRoster(supabase, classroomId),
  ]);
  return { sessions: sessions || [], records: records || [], students: roster.students };
}

const VIEWS = { work: loadWork, roster: loadRoster, attendance: loadAttendance } as const;

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const ctx = await context(request, params.get('g'));
  if (ctx instanceof NextResponse) return ctx;
  const view = params.get('view') as keyof typeof VIEWS | null;
  const load = view && view in VIEWS ? VIEWS[view] : null;
  const data = load ? await load(createServiceSupabaseClient(), ctx.classroom.id) : undefined;
  const { classroom, teacher } = ctx;
  return NextResponse.json({
    teacher: {
      id: ctx.teacherId,
      firstName: teacher.first_name || '',
      name: `${teacher.first_name || ''} ${teacher.last_name || ''}`.trim(),
      isOwner: classroom.teacher_id === ctx.teacherId,
    },
    classroom: {
      id: classroom.id,
      name: classroom.name,
      title: classroomTitle(classroom),
      subject: subjectName(classroom),
      inviteCode: classroom.invite_code || null,
      courseId: classroom.course_id || null,
      groupName: ctx.groupName || null,
    },
    ...(data ? { view, data } : {}),
  });
}

/** Cards the teacher LIFF pages send for existing things (new work, check-ins and results come with their share). */
type Kind = 'work' | 'invite' | 'guide' | 'remind' | 'open' | 'results';
const KINDS: Kind[] = ['work', 'invite', 'guide', 'remind', 'open', 'results'];

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const ctx = await context(request, typeof body.g === 'string' ? body.g : null);
  if (ctx instanceof NextResponse) return ctx;
  const kind = body.kind as Kind;
  if (!KINDS.includes(kind)) return NextResponse.json({ error: 'ไม่รู้จักการ์ดนี้' }, { status: 400 });
  const result = await messagesFor(createServiceSupabaseClient(), ctx.classroom, kind, body);
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ messages: result.messages });
}

/** What the page sends into the group (liff.sendMessages): the card, or for "ทวงงาน" the reminder picture the bot answers. */
async function messagesFor(
  supabase: ServiceClient,
  classroom: LinkClassroom,
  kind: Kind,
  body: { assignmentId?: unknown; sessionId?: unknown }
): Promise<{ messages: LineMessage[] } | { error: string; status: number }> {
  const done = (messages: LineMessage[] | null) => (messages ? { messages } : { error: 'ยังไม่ได้ตั้งค่า LIFF ของระบบ', status: 503 });
  if (kind === 'invite') return done(inviteMessages(classroom));
  if (kind === 'guide') return done(await guideMessages(supabase, classroom));
  if (kind === 'open') return done(await openClassMessages(supabase, classroom));
  const { data: assignment } = await supabase
    .from('assignments')
    .select('*')
    .eq('id', String(body.assignmentId || ''))
    .eq('classroom_id', classroom.id)
    .maybeSingle<Assignment>();
  if (!assignment) return { error: 'ไม่พบงานนี้', status: 404 };
  const win = getAssignmentWindow(assignment);
  if (win.isDraft || win.isScheduled) return { error: 'งานนี้ยังไม่เผยแพร่', status: 409 };
  if (kind === 'results') return done(await resultsMessages(supabase, assignment, classroom));
  if (kind === 'work') return done(await workMessages(supabase, assignment, classroom));
  // ทวงงาน: the picture; the bot answers it in the group with the card and @mentions.
  if (!win.acceptsSubmissions) return { error: 'งานนี้ปิดรับแล้ว', status: 409 };
  const { data: room } = await supabase.from('classrooms').select('id, name, course_name, subject_code, invite_code, students').eq('id', classroom.id).maybeSingle();
  if (!room || !(await missingStudents(supabase, assignment, room)).missing.length) return { error: 'นักเรียนส่งงานนี้ครบแล้ว', status: 409 };
  return { messages: [remindPicture(classroom, assignment)] };
}
