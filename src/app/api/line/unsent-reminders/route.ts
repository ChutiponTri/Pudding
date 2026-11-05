import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { getTeacherAccess, teacherBlockedResponse } from '@/lib/server/teacherProfileGuard';
import { remindShare } from '@/lib/server/classroomPosts';
import { clearUnsentReminder, missingStudentNames, reminderLineText, type UnsentReminder } from '@/lib/server/workReminder';
import { getAssignmentWindow } from '@/lib/utils/assignmentWindow';
import type { Assignment, User } from '@/types/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Room = { id: string; name: string; course_name?: string | null; subject_code?: string | null; invite_code?: string | null; students?: User[] | null };

/** The teacher's classrooms (owner or co-teacher), with what a reminder needs. */
async function teacherRooms(supabase: ReturnType<typeof createServiceSupabaseClient>, userId: string): Promise<Map<string, Room>> {
  const fields = 'id, name, course_name, subject_code, invite_code, students';
  const [own, shared] = await Promise.all([
    supabase.from('classrooms').select(fields).eq('teacher_id', userId),
    supabase.from('classrooms').select(fields).contains('teachers', JSON.stringify([{ teacher_id: userId }])),
  ]);
  return new Map([...(own.data || []), ...(shared.data || [])].map((room) => [room.id as string, room as Room]));
}

/**
 * GET: deadline reminders the cron could not send to the teacher's class
 * groups (see /api/line/reminders), for the "share it yourself" popup. Only
 * work still taking hand-ins, rebuilt now so the list names who is still
 * missing; reminders nobody needs any more are cleared on the way.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const access = await getTeacherAccess(userId);
  if (access !== 'ok') return teacherBlockedResponse(access);

  const supabase = createServiceSupabaseClient();
  const rooms = await teacherRooms(supabase, userId);
  if (!rooms.size) return NextResponse.json({ reminders: [] });
  const { data, error } = await supabase
    .from('assignments')
    .select('*')
    .in('classroom_id', [...rooms.keys()])
    .not('line_reminder_unsent', 'is', null);
  // Databases without the column (supabase_reminder_unsent_update.sql not run yet): nothing to show.
  if (error) return NextResponse.json({ reminders: [] });

  const reminders = [];
  for (const work of (data || []) as Array<Assignment & { line_reminder_unsent: UnsentReminder }>) {
    const unsent = work.line_reminder_unsent;
    if (!unsent || unsent.reason === 'retry') continue;
    const room = rooms.get(work.classroom_id);
    if (!room) continue;
    const names = getAssignmentWindow(work).acceptsSubmissions ? await missingStudentNames(supabase, work, room) : [];
    if (!names.length) {
      await clearUnsentReminder(supabase, work.id);
      continue;
    }
    const text = reminderLineText(work, room, names);
    reminders.push({ assignmentId: work.id, title: work.title, reason: unsent.reason, at: unsent.at, ...remindShare(work.id, text) });
  }
  return NextResponse.json({ reminders });
}

/** POST { assignmentId }: the teacher shared or dismissed the reminder; stop offering it. */
export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const access = await getTeacherAccess(userId);
  if (access !== 'ok') return teacherBlockedResponse(access);

  const body = await request.json().catch(() => ({}));
  const assignmentId = typeof body.assignmentId === 'string' ? body.assignmentId : '';
  if (!assignmentId) return NextResponse.json({ error: 'assignmentId is required' }, { status: 400 });
  const supabase = createServiceSupabaseClient();
  const { data: work } = await supabase.from('assignments').select('classroom_id').eq('id', assignmentId).maybeSingle();
  const rooms = work ? await teacherRooms(supabase, userId) : new Map();
  if (!work || !rooms.has(work.classroom_id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  await clearUnsentReminder(supabase, assignmentId);
  return NextResponse.json({ success: true });
}
