import { NextRequest, NextResponse } from 'next/server';
import { getActor } from '@/lib/auth/actor';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { canLinkLine, findBotGroupByRef, findLinkedClassroom, liffConnectUrl, type LinkClassroom, type ServiceClient } from '@/lib/line/groupLink';
import { attendanceMessages, guideMessages, inviteMessages, openClassMessages, remindPicture, resultsMessages, workMessages, type LineMessage } from '@/lib/line/teacherCards';
import { missingStudents } from '@/lib/server/workReminder';
import { getTeacherAccess, teacherAccessMessage } from '@/lib/server/teacherProfileGuard';
import { classroomTitle, subjectName } from '@/lib/utils/classroomLabel';
import { getAssignmentWindow } from '@/lib/utils/assignmentWindow';
import type { Assignment } from '@/types/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The teacher LIFF pages (/liff/teacher), opened from the group menu card
 * with ?g=<group ref>. GET: the classroom linked to that group, for this
 * teacher (owner, co-teacher or TA). POST: the messages for the page to send
 * into the group with liff.sendMessages (a finished card, or the reminder
 * picture the bot answers).
 * The caller is the LINE account in the LIFF token (see getActor); the page's
 * other reads and writes go through the web's own APIs as the same teacher.
 */

type Context = { teacherId: string; classroom: LinkClassroom; groupName?: string };

async function context(request: NextRequest, ref: string | null): Promise<Context | NextResponse> {
  const actor = await getActor(request, { allowIncompleteProfile: true });
  if (!actor || actor.kind !== 'teacher') {
    return NextResponse.json({ error: 'หน้านี้สำหรับคุณครูเท่านั้น (เข้าสู่ระบบเว็บ Pudding ด้วย LINE บัญชีนี้ก่อน)', code: 'not-teacher' }, { status: 403 });
  }
  const access = await getTeacherAccess(actor.userId);
  if (access !== 'ok') return NextResponse.json({ error: teacherAccessMessage(access), code: access }, { status: 403 });
  if (!ref) return NextResponse.json({ error: 'เปิดหน้านี้จากเมนูครูในกลุ่ม LINE', code: 'no-group' }, { status: 400 });
  const supabase = createServiceSupabaseClient();
  const group = await findBotGroupByRef(supabase, ref);
  if (!group) return NextResponse.json({ error: 'ไม่พบกลุ่มนี้ (บอทอาจถูกนำออกจากกลุ่มแล้ว) เชิญ Pudding Bot เข้ากลุ่มอีกครั้ง', code: 'no-group' }, { status: 404 });
  const classroom = await findLinkedClassroom(supabase, group.groupId);
  if (!classroom) {
    return NextResponse.json({ error: 'กลุ่มนี้ยังไม่ได้เชื่อมกับห้องเรียน', code: 'not-linked', connectUrl: liffConnectUrl(ref) }, { status: 409 });
  }
  if (!canLinkLine(classroom, actor.userId)) {
    return NextResponse.json({ error: 'คุณครูไม่ได้เป็นผู้สอนของห้องเรียนที่เชื่อมกับกลุ่มนี้', code: 'not-staff' }, { status: 403 });
  }
  return { teacherId: actor.userId, classroom, groupName: classroom.line_group_name || group.groupName };
}

export async function GET(request: NextRequest) {
  const ctx = await context(request, request.nextUrl.searchParams.get('g'));
  if (ctx instanceof NextResponse) return ctx;
  const supabase = createServiceSupabaseClient();
  const [{ data: teacher }, { data: room }] = await Promise.all([
    supabase.from('users').select('first_name, last_name').eq('id', ctx.teacherId).maybeSingle(),
    supabase.from('classrooms').select('course_id').eq('id', ctx.classroom.id).maybeSingle(),
  ]);
  const { classroom } = ctx;
  return NextResponse.json({
    teacher: {
      id: ctx.teacherId,
      firstName: teacher?.first_name || '',
      name: `${teacher?.first_name || ''} ${teacher?.last_name || ''}`.trim(),
      isOwner: classroom.teacher_id === ctx.teacherId,
    },
    classroom: {
      id: classroom.id,
      name: classroom.name,
      title: classroomTitle(classroom),
      subject: subjectName(classroom),
      inviteCode: classroom.invite_code || null,
      courseId: (room?.course_id as string | null) || null,
      groupName: ctx.groupName || null,
    },
  });
}

/** Cards the teacher LIFF pages send for existing things (new work, check-ins and results come with their share). */
type Kind = 'work' | 'attendance' | 'invite' | 'guide' | 'remind' | 'open' | 'results';
const KINDS: Kind[] = ['work', 'attendance', 'invite', 'guide', 'remind', 'open', 'results'];

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
  if (kind === 'attendance') {
    const { data: session } = await supabase
      .from('attendance_sessions')
      .select('id, title, starts_at, on_time_until_minutes, late_until_minutes, status')
      .eq('id', String(body.sessionId || ''))
      .eq('classroom_id', classroom.id)
      .maybeSingle();
    if (!session) return { error: 'ไม่พบคาบเช็กชื่อนี้', status: 404 };
    if (session.status !== 'open') return { error: 'คาบเช็กชื่อนี้ปิดรับแล้ว', status: 409 };
    return done(attendanceMessages(session, classroom));
  }
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
