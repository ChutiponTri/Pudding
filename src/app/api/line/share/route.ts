import { after, NextRequest, NextResponse } from 'next/server';
import { signalClassroom } from '@/lib/realtime/classroomSignal';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { joinLineText, postLineText, reannounceLineText, resultsLineText, type PostActivityType } from '@/lib/line/classroomAnnouncement';
import { lineMessagesForText } from '@/lib/line/messaging';
import { parseShareToken } from '@/lib/server/inviteCodes';
import { clearUnsentReminder, missingStudentNames, reminderLineText } from '@/lib/server/workReminder';
import type { Assignment } from '@/types/database';
import { classroomTitle } from '@/lib/utils/classroomLabel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/line/share?t=<postShareToken>
 * The LINE messages of one timeline post, for /liff/share to send from the
 * teacher's own LINE account (shareTargetPicker). The signed token is the
 * permission: the teacher got it when the bot could not send the post.
 */
export async function GET(request: NextRequest) {
  const target = parseShareToken(request.nextUrl.searchParams.get('t'));
  if (!target) return NextResponse.json({ error: 'ลิงก์แชร์ไม่ถูกต้อง' }, { status: 404 });

  const supabase = createServiceSupabaseClient();
  if (target.kind === 'join') {
    // A classroom's invitation ("เชิญในไลน์"): rebuilt now, so it carries the current join code.
    const { data: room } = await supabase.from('classrooms').select('id, name, course_name, subject_code, invite_code').eq('id', target.id).maybeSingle();
    if (!room) return NextResponse.json({ error: 'ไม่พบห้องเรียนนี้ อาจถูกลบไปแล้ว' }, { status: 404 });
    const text = joinLineText(room);
    return NextResponse.json({ classroom: classroomTitle(room), text, messages: lineMessagesForText(text) });
  }
  if (target.kind === 'remind') {
    // A work's reminder ("ทวงงาน"): rebuilt now, so it names only who still has not handed in.
    const { data: assignment } = await supabase.from('assignments').select('*').eq('id', target.id).maybeSingle<Assignment>();
    if (!assignment) return NextResponse.json({ error: 'ไม่พบงานนี้ อาจถูกลบไปแล้ว' }, { status: 404 });
    const { data: room } = await supabase
      .from('classrooms')
      .select('id, name, course_name, subject_code, invite_code, students')
      .eq('id', assignment.classroom_id)
      .maybeSingle();
    if (!room) return NextResponse.json({ error: 'ไม่พบห้องเรียนของงานนี้' }, { status: 404 });
    const names = await missingStudentNames(supabase, assignment, room);
    if (!names.length) return NextResponse.json({ error: 'นักเรียนส่งงานนี้ครบแล้ว ไม่ต้องทวงแล้ว' }, { status: 409 });
    const text = reminderLineText(assignment, room, names);
    return NextResponse.json({ classroom: classroomTitle(room), text, messages: lineMessagesForText(text) });
  }
  if (target.kind === 'results') {
    // A work's score announcement ("ประกาศคะแนน").
    const { data: assignment } = await supabase.from('assignments').select('id, title, is_exam, classroom_id').eq('id', target.id).maybeSingle<Assignment>();
    if (!assignment) return NextResponse.json({ error: 'ไม่พบงานนี้ อาจถูกลบไปแล้ว' }, { status: 404 });
    const { data: room } = await supabase
      .from('classrooms')
      .select('id, name, course_name, subject_code, invite_code')
      .eq('id', assignment.classroom_id)
      .maybeSingle();
    if (!room) return NextResponse.json({ error: 'ไม่พบห้องเรียนของงานนี้' }, { status: 404 });
    const text = resultsLineText(assignment, room);
    return NextResponse.json({ classroom: classroomTitle(room), text, messages: lineMessagesForText(text) });
  }
  if (target.kind === 'reannounce') {
    // A work's link posted again ("ส่งซ้ำ"): rebuilt from the work, so it shows the current deadline.
    const { data: assignment } = await supabase.from('assignments').select('*').eq('id', target.id).maybeSingle<Assignment>();
    if (!assignment) return NextResponse.json({ error: 'ไม่พบงานนี้ อาจถูกลบไปแล้ว' }, { status: 404 });
    const { data: room } = await supabase
      .from('classrooms')
      .select('id, name, course_name, subject_code, invite_code')
      .eq('id', assignment.classroom_id)
      .maybeSingle();
    if (!room) return NextResponse.json({ error: 'ไม่พบห้องเรียนของงานนี้' }, { status: 404 });
    const text = reannounceLineText(assignment, room);
    return NextResponse.json({ classroom: classroomTitle(room), text, messages: lineMessagesForText(text) });
  }
  const postId = target.id;
  const { data: post } = await supabase
    .from('classroom_posts')
    .select('id, classroom_id, body, activity_type, metadata')
    .eq('id', postId)
    .maybeSingle();
  if (!post) return NextResponse.json({ error: 'ไม่พบโพสต์นี้ อาจถูกลบไปแล้ว' }, { status: 404 });
  const { data: classroom } = await supabase
    .from('classrooms')
    .select('id, name, course_name, subject_code, invite_code')
    .eq('id', post.classroom_id)
    .maybeSingle();
  if (!classroom) return NextResponse.json({ error: 'ไม่พบห้องเรียนของโพสต์นี้' }, { status: 404 });

  const text = postLineText({ ...post, activity_type: post.activity_type as PostActivityType }, classroom);
  return NextResponse.json({ classroom: classroomTitle(classroom), text, messages: lineMessagesForText(text) });
}

/**
 * POST /api/line/share { t }: the teacher shared the post from their own LINE
 * (shareTargetPicker said so), so the timeline stops offering it as unsent.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const target = parseShareToken(body.t);
  if (!target) return NextResponse.json({ error: 'ลิงก์แชร์ไม่ถูกต้อง' }, { status: 404 });
  if (target.kind === 'remind') {
    // A deadline reminder the cron could not send stops waiting on the teacher's pages.
    await clearUnsentReminder(createServiceSupabaseClient(), target.id);
    return NextResponse.json({ success: true });
  }
  // A re-announcement has no timeline post to update.
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
