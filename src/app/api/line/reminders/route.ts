import type { Assignment } from '@/types/database';
import { NextRequest, NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { pushLineGroupText } from '@/lib/line/messaging';
import { withLiffLink } from '@/lib/line/liffLink';
import { formatDateTime, SCHOOL_TIME_ZONE } from '@/lib/utils/datetime';
import { getAssignmentWindow, isAssignmentPublished } from '@/lib/utils/assignmentWindow';
import { announceScheduledPosts } from '@/lib/line/classroomAnnouncement';

export const runtime = 'nodejs';

type ReminderRow = {
  id: string;
  title: string;
  due_date: string;
  is_exam?: boolean;
  status_override?: Assignment['status_override'];
  extended_until?: string;
  reminder_offset_minutes: number;
  reminder_offsets_minutes?: number[] | null;
  classroom_id: string;
  line_last_reminded_at: string | null;
  publish_at?: string;
};
export const dynamic = 'force-dynamic';

/**
 * Run from a scheduler every five minutes (see supabase_reminder_cron.sql).
 * Also releases the LINE message for scheduled assignments.
 * Accepts GET (Vercel Cron, which sends `Authorization: Bearer $CRON_SECRET`)
 * and POST (pg_cron / any external scheduler).
 */
export async function GET(request: NextRequest) {
  return runReminders(request);
}

export async function POST(request: NextRequest) {
  return runReminders(request);
}

async function runReminders(request: NextRequest) {
  const secrets = [process.env.LINE_REMINDER_CRON_SECRET, process.env.CRON_SECRET].filter(Boolean);
  if (!secrets.length) {
    return NextResponse.json({ error: 'LINE_REMINDER_CRON_SECRET is not configured' }, { status: 503 });
  }
  const authorization = request.headers.get('authorization');
  if (!secrets.some((secret) => authorization === `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceSupabaseClient();
  const now = new Date();
  // Only rows with a reminder whose deadline (or extension) is still ahead.
  // reminder_offset_minutes holds the earliest reminder, so it is > 0 whenever any is set.
  // `*` so databases without the newer optional columns still work.
  const { data: rows, error } = await supabase
    .from('assignments')
    .select('*')
    .gt('reminder_offset_minutes', 0)
    .or(`due_date.gt.${now.toISOString()},extended_until.gt.${now.toISOString()}`)
    .returns<ReminderRow[]>();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const announced = await announceScheduledPosts(supabase, now);
  // Filtered here rather than with `neq`, which would also drop NULL rows.
  // Quizzes close at the deadline, so they get no reminder.
  // Unpublished (scheduled) work gets no reminder yet.
  const assignments = (rows || []).filter(
    (row) => !row.is_exam && row.status_override !== 'force_closed' && isAssignmentPublished(row, now.getTime())
  );

  let sent = 0;
  const failed: string[] = [];
  for (const assignment of assignments) {
    // Follow the teacher's extension, if any, so the reminders move with the deadline.
    const dueAt = getAssignmentWindow(assignment).deadline;
    if (dueAt === null || now.getTime() >= dueAt) continue;
    const offsets = (assignment.reminder_offsets_minutes?.length ? assignment.reminder_offsets_minutes : [assignment.reminder_offset_minutes])
      .map(Number)
      .filter((offset) => offset > 0);
    // The most recent reminder time that has passed. One timestamp is enough to
    // track them all: reminders fire in order, and a late run sends once.
    const reminderAt = Math.max(...offsets.map((offset) => dueAt - offset * 60 * 1000).filter((at) => at <= now.getTime()));
    if (!Number.isFinite(reminderAt)) continue;
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
    try {
      await pushLineGroupText(
        classroom.line_group_id,
        withLiffLink(
          `🔔 แจ้งเตือนส่งงาน\n${assignment.title}\nห้อง: ${classroom.name}\nกำหนดส่ง: ${dueLabel}\n\nยังไม่ส่งงาน (${names.length} คน):\n${names.map((name, index) => `${index + 1}. ${name}`).join('\n')}`,
          'กดเพื่อส่งงาน',
          { classroomId: assignment.classroom_id, assignmentId: assignment.id }
        )
      );
    } catch (pushError) {
      // One failed group (bot removed, quota) must not stop the others.
      console.error(`LINE reminder failed for assignment ${assignment.id}:`, pushError);
      failed.push(assignment.id);
      continue;
    }
    await supabase.from('assignments').update({ line_last_reminded_at: now.toISOString() }).eq('id', assignment.id);
    sent += 1;
  }
  return NextResponse.json({ ok: true, checked: assignments.length, sent, failed, announced });
}

