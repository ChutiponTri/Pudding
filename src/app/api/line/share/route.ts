import { after, NextRequest, NextResponse } from 'next/server';
import { signalClassroom } from '@/lib/realtime/classroomSignal';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { attendanceLineText, joinLineText, postLineText, reannounceLineText, resultsLineText, type PostActivityType } from '@/lib/line/classroomAnnouncement';
import { lineMessagesForText } from '@/lib/line/messaging';
import { attendanceMessages, inviteMessages, remindPicture, resultsMessages, workMessages, type LineMessage } from '@/lib/line/teacherCards';
import { parseShareToken } from '@/lib/server/inviteCodes';
import { resolveTeacherInvite } from '@/lib/server/dataActions';
import { missingStudentNames, reminderLineText } from '@/lib/server/workReminder';
import type { Assignment, User } from '@/types/database';
import { classroomTitle } from '@/lib/utils/classroomLabel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROOM_COLUMNS = 'id, name, course_name, subject_code, invite_code, teacher_id, line_group_id';
/** students: a reminder names who has not handed in. */
const WORK_ROOM_COLUMNS = `${ROOM_COLUMNS}, students`;

type Room = { id: string; name: string; course_name?: string | null; subject_code?: string | null; invite_code?: string | null; teacher_id?: string | null; line_group_id?: string | null; students?: User[] | null };
type Post = { id: string; classroom_id: string; body: string; activity_type: string; metadata: Record<string, unknown> | null };
/** An embedded classroom (PostgREST returns one object for a to-one embed; an array on older setups). */
const one = <T,>(value: T | T[] | null | undefined): T | null => (Array.isArray(value) ? value[0] ?? null : value ?? null);
const SESSION_COLUMNS = 'id, classroom_id, title, starts_at, on_time_until_minutes, late_until_minutes, status';

/**
 * The share's answer: what the teacher's LINE sends (the card, or for a
 * reminder the picture the bot answers), and its words for the preview / copy.
 * The plain text card stands in whenever a card cannot be made.
 */
function shared(classroom: string, text: string, messages: LineMessage[] | null) {
  return NextResponse.json({ classroom, text, messages: messages || lineMessagesForText(text) });
}

/**
 * GET /api/line/share?t=<share token>
 * What one share sends into a LINE group from the teacher's own LINE: the
 * work, results, check-in or invite card, or the reminder picture (the bot
 * answers it with the reminder card and @mentions). Used by /liff/share (the
 * website: shareTargetPicker) and the teacher LIFF pages (liff.sendMessages,
 * straight into the group). No message quota is used. The signed token is the
 * permission: the teacher got it from their own action.
 */
export async function GET(request: NextRequest) {
  const target = parseShareToken(request.nextUrl.searchParams.get('t'));
  if (!target) return NextResponse.json({ error: 'ลิงก์แชร์ไม่ถูกต้อง' }, { status: 404 });

  const supabase = createServiceSupabaseClient();
  if (target.kind === 'teacher') {
    // A co-teacher invitation: the code itself is signed, so it only resolves for the course and role it was made for.
    const invite = await resolveTeacherInvite(supabase, target.id);
    if (!invite) return NextResponse.json({ error: 'ลิงก์เชิญไม่ถูกต้อง หรือรายวิชาถูกลบไปแล้ว' }, { status: 404 });
    const course = `${invite.course.code || ''} ${invite.course.name || ''}`.trim();
    const role = invite.role === 'researcher' ? 'ผู้ตรวจเพื่อวิจัย (IRR)' : 'TA (ผู้ช่วยสอน)';
    const text = `👩‍🏫 เชิญร่วมสอน\n📘 ${course}\nบทบาท: ${role}\nกดปุ่มด้านล่างแล้วเข้าสู่ระบบเพื่อตอบรับคำเชิญ\n\n👉 ตอบรับคำเชิญ\n${request.nextUrl.origin}/teacher-invite?code=${target.id}`;
    return shared(course, text, null);
  }
  if (target.kind === 'attendance') {
    // An open check-in period: rebuilt now, from its current deadlines.
    // The session and its classroom in one request.
    const { data: row } = await supabase
      .from('attendance_sessions')
      .select(`${SESSION_COLUMNS}, classroom:classrooms(${ROOM_COLUMNS})`)
      .eq('id', target.id)
      .maybeSingle();
    if (!row) return NextResponse.json({ error: 'ไม่พบคาบเช็กชื่อนี้ อาจถูกลบไปแล้ว' }, { status: 404 });
    const { classroom: embedded, ...session } = row as typeof row & { classroom?: Room | Room[] | null };
    if (session.status !== 'open') return NextResponse.json({ error: 'คาบเช็กชื่อนี้ปิดรับแล้ว' }, { status: 409 });
    const room = one(embedded);
    if (!room) return NextResponse.json({ error: 'ไม่พบห้องเรียนของคาบนี้' }, { status: 404 });
    return shared(classroomTitle(room), attendanceLineText(session, room), attendanceMessages(session, room));
  }
  if (target.kind === 'join') {
    // A classroom's invitation ("เชิญในไลน์"): rebuilt now, so it carries the current join code.
    const { data: room } = await supabase.from('classrooms').select(ROOM_COLUMNS).eq('id', target.id).maybeSingle();
    if (!room) return NextResponse.json({ error: 'ไม่พบห้องเรียนนี้ อาจถูกลบไปแล้ว' }, { status: 404 });
    return shared(classroomTitle(room), joinLineText(room), inviteMessages(room));
  }

  // The rest are about one work (or a post, which may be about one). Each row
  // comes with its classroom embedded: one request instead of two.
  let assignmentId = target.kind === 'post' ? '' : target.id;
  let post: Post | null = null;
  let room: Room | null = null;
  if (target.kind === 'post') {
    const { data } = await supabase
      .from('classroom_posts')
      .select(`id, classroom_id, body, activity_type, metadata, classroom:classrooms(${WORK_ROOM_COLUMNS})`)
      .eq('id', target.id)
      .maybeSingle();
    if (!data) return NextResponse.json({ error: 'ไม่พบโพสต์นี้ อาจถูกลบไปแล้ว' }, { status: 404 });
    const { classroom: embedded, ...rest } = data as typeof data & { classroom?: Room | Room[] | null };
    post = rest as Post;
    room = one(embedded);
    const metadata = (rest.metadata || {}) as Record<string, unknown>;
    if ((rest.activity_type === 'assignment' || rest.activity_type === 'exam') && typeof metadata.assignmentId === 'string') assignmentId = metadata.assignmentId;
  }
  let assignment: Assignment | null = null;
  if (assignmentId) {
    const { data } = await supabase
      .from('assignments')
      .select(post ? '*' : `*, classroom:classrooms(${WORK_ROOM_COLUMNS})`)
      .eq('id', assignmentId)
      .maybeSingle();
    if (!data) return NextResponse.json({ error: 'ไม่พบงานนี้ อาจถูกลบไปแล้ว' }, { status: 404 });
    const { classroom: embedded, ...rest } = data as unknown as Assignment & { classroom?: Room | Room[] | null };
    assignment = rest as Assignment;
    room ||= one(embedded);
  }
  if (!room) return NextResponse.json({ error: 'ไม่พบห้องเรียนนี้' }, { status: 404 });
  const title = classroomTitle(room);

  if (target.kind === 'remind' && assignment) {
    // "ทวงงาน": names only who still has not handed in.
    const names = await missingStudentNames(supabase, assignment, room);
    if (!names.length) return NextResponse.json({ error: 'นักเรียนส่งงานนี้ครบแล้ว ไม่ต้องทวงแล้ว' }, { status: 409 });
    // In the class group the picture is enough: the bot answers it with the card and @mentions.
    return shared(title, reminderLineText(assignment, room, names), room.line_group_id ? [remindPicture(room, assignment)] : null);
  }
  if (target.kind === 'results' && assignment) {
    return shared(title, resultsLineText(assignment, room), await resultsMessages(supabase, assignment, room));
  }
  if (target.kind === 'reannounce' && assignment) {
    return shared(title, reannounceLineText(assignment, room), await workMessages(supabase, assignment, room));
  }
  if (post) {
    const metadata = (post.metadata || {}) as Record<string, unknown>;
    const text = postLineText({ ...post, activity_type: post.activity_type as PostActivityType }, room);
    if (assignment) return shared(title, text, await workMessages(supabase, assignment, room));
    if (post.activity_type === 'attendance' && typeof metadata.sessionId === 'string') {
      const { data: session } = await supabase.from('attendance_sessions').select(SESSION_COLUMNS).eq('id', metadata.sessionId).maybeSingle();
      if (session) return shared(title, text, attendanceMessages(session, room));
    }
    return shared(title, text, null);
  }
  return NextResponse.json({ error: 'ลิงก์แชร์ไม่ถูกต้อง' }, { status: 404 });
}

/**
 * POST /api/line/share { t }: the teacher shared the post from their own LINE
 * (shareTargetPicker said so), so the timeline stops offering it as unsent.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const target = parseShareToken(body.t);
  if (!target) return NextResponse.json({ error: 'ลิงก์แชร์ไม่ถูกต้อง' }, { status: 404 });
  // Only a timeline post remembers that it waits to be sent.
  if (target.kind !== 'post') return NextResponse.json({ success: true });
  const postId = target.id;
  const supabase = createServiceSupabaseClient();
  const { data: post } = await supabase.from('classroom_posts').select('id, classroom_id, metadata').eq('id', postId).maybeSingle();
  if (!post) return NextResponse.json({ error: 'ไม่พบโพสต์นี้' }, { status: 404 });
  const metadata: Record<string, unknown> = { ...((post.metadata || {}) as Record<string, unknown>), sharedManuallyAt: new Date().toISOString() };
  delete metadata.lineStatus;
  await supabase.from('classroom_posts').update({ metadata }).eq('id', postId);
  after(() => signalClassroom(post.classroom_id, { type: 'timeline' }));
  return NextResponse.json({ success: true });
}
