import { NextRequest, NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { pushLineGroupText } from '@/lib/line/messaging';
import { withLiffLink } from '@/lib/line/liffLink';
import { formatDateTime, SCHOOL_TIME_ZONE } from '@/lib/utils/datetime';
import { getAssignmentWindow } from '@/lib/utils/assignmentWindow';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Run from a scheduler every five minutes. */
export async function POST(request: NextRequest) {
  const cronSecret = process.env.LINE_REMINDER_CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: 'LINE_REMINDER_CRON_SECRET is not configured' }, { status: 503 });
  }
  if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceSupabaseClient();
  const now = new Date();
  const { data: assignments, error } = await supabase
    .from('assignments')
    .select('id, title, due_date, status_override, extended_until, reminder_offset_minutes, classroom_id, line_last_reminded_at')
    .eq('is_exam', false)
    .neq('status_override', 'force_closed');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let sent = 0;
  for (const assignment of assignments || []) {
    // Quizzes are filtered out above (is_exam = false): they close at the deadline, so no reminder.
    if (!assignment.reminder_offset_minutes || Number(assignment.reminder_offset_minutes) <= 0) continue;
    // Follow the teacher's extension, if any, so the reminder moves with the deadline.
    const dueAt = getAssignmentWindow(assignment).deadline;
    if (dueAt === null) continue;
    const reminderAt = dueAt - Number(assignment.reminder_offset_minutes || 1440) * 60 * 1000;
    if (now.getTime() < reminderAt || now.getTime() >= dueAt) continue;
    if (assignment.line_last_reminded_at && new Date(assignment.line_last_reminded_at).getTime() >= reminderAt) continue;

    const { data: classroom } = await supabase
      .from('classrooms')
      .select('name, line_group_id, students')
      .eq('id', assignment.classroom_id)
      .maybeSingle();
    if (!classroom?.line_group_id) continue;

    const roster = (classroom.students || []) as Array<{ id?: string; first_name?: string; last_name?: string; name?: string }>;
    const ids = roster.map((student) => student.id).filter(Boolean);
    const { data: submissions } = await supabase
      .from('submissions')
      .select('student_id')
      .eq('assignment_id', assignment.id)
      .in('student_id', ids.length ? ids : ['__none__']);
    const submitted = new Set((submissions || []).map((submission) => submission.student_id));
    const missing = roster.filter((student) => student.id && !submitted.has(student.id));
    if (!missing.length) continue;

    const names = missing.map((student) => `${student.first_name || ''} ${student.last_name || ''}`.trim() || student.name || 'ไม่ระบุชื่อ');
    // The server clock is UTC; LINE readers are in Thailand.
    const dueLabel = formatDateTime(new Date(dueAt).toISOString(), 'th', SCHOOL_TIME_ZONE);
    await pushLineGroupText(
      classroom.line_group_id,
      withLiffLink(
        `🔔 แจ้งเตือนส่งงาน\n${assignment.title}\nห้อง: ${classroom.name}\nกำหนดส่ง: ${dueLabel}\n\nยังไม่ส่งงาน (${names.length} คน):\n${names.map((name, index) => `${index + 1}. ${name}`).join('\n')}`,
        'กดเพื่อส่งงาน',
        { classroomId: assignment.classroom_id, assignmentId: assignment.id }
      )
    );
    await supabase.from('assignments').update({ line_last_reminded_at: now.toISOString() }).eq('id', assignment.id);
    sent += 1;
  }
  return NextResponse.json({ ok: true, sent });
}
