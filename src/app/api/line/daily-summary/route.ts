import { NextRequest, NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { cronAuthError } from '@/lib/server/cronAuth';
import { summaryCard, summaryRows, teacherSummaryCard, type TeacherSummary } from '@/lib/server/dailySummary';
import { messagesLeftThisMonth, pushLineMessages, validateLineMessages } from '@/lib/line/messaging';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Tries the "สรุปประจำวัน" card without spending the LINE quota (same
 * Bearer secret as the scheduler). Every GET asks LINE to validate the card
 * (free); paste `message.contents` into the Flex Message Simulator to see it.
 *   GET  ?sample=1          made-up days (one row, all rows, big numbers)
 *   GET  ?teacherId=<id>    that teacher's card right now
 *   POST {"teacherId":"…"}  push it to that teacher (costs 1 message)
 * A teacher can also type "สรุป" in the bot's 1:1 chat: a free reply.
 */

const base: TeacherSummary = { handedToday: 0, toGrade: 0, toGradeWorks: [], remindRooms: 0, remindStudents: 0, remindAllQuizzes: false, pendingStudents: 0, pendingRooms: [] };
const SAMPLES: Record<string, TeacherSummary> = {
  remindOnly: { ...base, remindRooms: 1, remindStudents: 3 },
  gradingOnly: { ...base, handedToday: 2, toGrade: 1, toGradeWorks: [{ id: 'sample', isExam: false }] },
  toGradeOnly: { ...base, toGrade: 7, toGradeWorks: [{ id: 'a', isExam: true }, { id: 'b', isExam: true }] },
  everything: {
    handedToday: 128,
    toGrade: 46,
    toGradeWorks: [{ id: 'a', isExam: false }, { id: 'b', isExam: true }],
    remindRooms: 12,
    remindStudents: 230,
    remindAllQuizzes: false,
    pendingStudents: 5,
    pendingRooms: ['x', 'y'],
  },
};

export async function GET(request: NextRequest) {
  const denied = cronAuthError(request);
  if (denied) return denied;
  const params = request.nextUrl.searchParams;
  if (params.get('sample')) {
    const results = await Promise.all(
      Object.entries(SAMPLES).map(async ([name, summary]) => {
        const message = summaryCard(summaryRows(summary));
        return { name, validation: message ? await validateLineMessages([message]) : null, message };
      })
    );
    return NextResponse.json({ quotaLeft: await messagesLeftThisMonth(), results });
  }
  const teacherId = params.get('teacherId');
  if (!teacherId) return NextResponse.json({ error: 'Pass ?sample=1 or ?teacherId=' }, { status: 400 });
  const { summary, rows, card } = await teacherSummaryCard(createServiceSupabaseClient(), teacherId);
  return NextResponse.json({ summary, rows, validation: card ? await validateLineMessages([card]) : null, message: card });
}

export async function POST(request: NextRequest) {
  const denied = cronAuthError(request);
  if (denied) return denied;
  const body = await request.json().catch(() => ({}));
  const teacherId = typeof body.teacherId === 'string' ? body.teacherId : '';
  const supabase = createServiceSupabaseClient();
  const { data: teacher } = await supabase.from('users').select('teacher_line_uid').eq('id', teacherId).eq('role', 'teacher').maybeSingle();
  if (!teacher?.teacher_line_uid) return NextResponse.json({ error: 'Teacher has no LINE account' }, { status: 404 });
  const { card } = await teacherSummaryCard(supabase, teacherId);
  if (!card) return NextResponse.json({ sent: false, reason: 'nothing to report today' });
  try {
    await pushLineMessages(teacher.teacher_line_uid, [card]);
    return NextResponse.json({ sent: true });
  } catch (error) {
    return NextResponse.json({ sent: false, error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
