import type { Assignment } from '@/types/database';
import { NextRequest, NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { groupPushAffordable, isLineQuotaError, pushLineGroupText } from '@/lib/line/messaging';
import { missingStudentNames, REMINDER_TRIES, reminderLineText, saveReminderOutcome, type UnsentReminder } from '@/lib/server/workReminder';
import { getAssignmentWindow, isAssignmentPublished } from '@/lib/utils/assignmentWindow';
import { announceScheduledPosts } from '@/lib/line/classroomAnnouncement';
import { deleteExpiredAssignmentDrafts } from '@/lib/server/assignmentDrafts';

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
  line_reminder_unsent?: UnsentReminder | null;
  publish_at?: string;
};
export const dynamic = 'force-dynamic';

/**
 * Run from a scheduler every five minutes (see supabase_reminder_cron.sql).
 * Also releases the LINE message for scheduled assignments and deletes drafts
 * that were never published within DRAFT_RETENTION_DAYS.
 * A reminder the bot cannot send (monthly LINE quota short for the group's
 * size, no linked group, or LINE refusing it REMINDER_TRIES times) is not
 * retried: it is saved on the work (line_reminder_unsent) and the teacher's
 * pages offer to share it from their own LINE (UnsentReminderNotice).
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
    .overrideTypes<ReminderRow[], { merge: false }>();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const announced = await announceScheduledPosts(supabase, now);
  const expiredDrafts = await deleteExpiredAssignmentDrafts(supabase, now);
  // Filtered here rather than with `neq`, which would also drop NULL rows.
  // Quizzes close at the deadline, so they get no reminder.
  // Unpublished (scheduled) work gets no reminder yet.
  const assignments = (rows || []).filter(
    (row) => !row.is_exam && row.status_override !== 'force_closed' && isAssignmentPublished(row, now.getTime())
  );

  let sent = 0;
  const failed: string[] = [];
  const unsentIds: string[] = [];
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

    const unsent = (assignment.line_reminder_unsent || null) as UnsentReminder | null;
    const { data: classroom } = await supabase
      .from('classrooms')
      .select('id, name, course_name, subject_code, line_group_id, students, invite_code')
      .eq('id', assignment.classroom_id)
      .maybeSingle();
    if (!classroom) continue;
    // Retakes remind only their students; reopened / "no submission" rows still count as missing.
    const names = await missingStudentNames(supabase, assignment as unknown as Assignment, classroom);
    if (!names.length) continue;
    // The bot cannot send it: the teacher's pages offer to share it by hand (UnsentReminderNotice).
    const giveUp = async (reason: UnsentReminder['reason']) => {
      await saveReminderOutcome(supabase, assignment.id, { reason, at: now.toISOString() }, true, now);
      unsentIds.push(assignment.id);
    };
    if (!classroom.line_group_id) {
      await giveUp('no_group');
      continue;
    }
    // Out of monthly messages for a group this size (billed per member): don't even try.
    const budget = await groupPushAffordable(classroom.line_group_id);
    if (budget.affordable === false) {
      await giveUp('quota');
      continue;
    }
    try {
      await pushLineGroupText(classroom.line_group_id, reminderLineText(assignment as unknown as Assignment, classroom, names));
    } catch (pushError) {
      // One failed group (bot removed, quota) must not stop the others.
      console.error(`LINE reminder failed for assignment ${assignment.id}:`, pushError);
      failed.push(assignment.id);
      if (isLineQuotaError(pushError)) {
        await giveUp('quota');
        continue;
      }
      // Another LINE error may pass: the next runs (5 min apart) try again a few times.
      const attempts = (unsent?.reason === 'retry' ? Number(unsent.attempts || 0) : 0) + 1;
      if (attempts >= REMINDER_TRIES) await giveUp('failed');
      else await saveReminderOutcome(supabase, assignment.id, { reason: 'retry', at: now.toISOString(), attempts }, false, now);
      continue;
    }
    await saveReminderOutcome(supabase, assignment.id, null, true, now);
    sent += 1;
  }
  return NextResponse.json({ ok: true, checked: assignments.length, sent, failed, unsent: unsentIds, announced, expiredDrafts });
}

