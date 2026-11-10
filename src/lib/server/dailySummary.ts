import 'server-only';
import { dailySummaryCard, type FlexMessage, type SummaryRow } from '@/lib/line/flex';
import { webUrl } from '@/lib/line/groupLink';
import { isLineQuotaError, LineApiError, messagesLeftThisMonth, pushLineMessages } from '@/lib/line/messaging';
import type { createServiceSupabaseClient } from '@/lib/supabase/server';
import { getAssignmentWindow } from '@/lib/utils/assignmentWindow';
import { SCHOOL_TIME_ZONE } from '@/lib/utils/datetime';
import { isGraded, isHandedIn } from '@/lib/utils/gradingStatus';
import { rosterFor } from '@/lib/utils/retake';
import { teacherAccessOf } from '@/lib/utils/teacherProfile';
import type { Assignment, ClassroomTeacher, Submission } from '@/types/database';

/**
 * "สรุปประจำวัน": once a day (from DAILY_SUMMARY_HOUR, Bangkok time) each
 * teacher gets one card in their 1:1 chat with the bot: hand-ins today and
 * what is left to grade, rooms with work due soon or overdue that students
 * have not handed in (time to ทวงงาน), and students waiting to be admitted.
 * A teacher with nothing on that list gets nothing that day.
 *
 * Cost: a push to one person is one message of the plan's monthly quota, so
 * pushes stop DAILY_SUMMARY_RESERVE messages short of the limit (scheduled
 * work cards need them more). Typing "สรุป" in the 1:1 chat gets the same
 * card as a free reply (see the webhook).
 *
 * Each teacher is claimed for the day (users.line_daily_summary_on) before the
 * push, so the five-minute scheduler never sends twice; a failed push is not
 * retried that day. Needs supabase_daily_summary_update.sql.
 */

type Supabase = ReturnType<typeof createServiceSupabaseClient>;

/** Local hour the summary goes out from; the scheduler keeps trying until LAST_HOUR. */
const DAILY_SUMMARY_HOUR = Number(process.env.LINE_DAILY_SUMMARY_HOUR || 17);
const LAST_HOUR = 21;
/** Messages kept back for scheduled work cards and notices. */
const DAILY_SUMMARY_RESERVE = Number(process.env.LINE_DAILY_SUMMARY_RESERVE || 30);
/** Work whose deadline is older than this no longer counts (last term's leftovers). */
const LOOKBACK_DAYS = 30;
/** "รอทวง": work still taking hand-ins whose deadline is past or within this. */
const REMIND_AHEAD_MS = 24 * 60 * 60 * 1000;
const PAGE = 1000;

const ASSIGNMENT_COLUMNS =
  'id, classroom_id, title, is_exam, is_survey, due_date, status_override, extended_until, close_at, publish_at, retake_of, retake_student_ids, created_at';

type WorkRow = Pick<
  Assignment,
  'id' | 'classroom_id' | 'title' | 'is_exam' | 'is_survey' | 'due_date' | 'status_override' | 'extended_until' | 'close_at' | 'publish_at' | 'retake_of' | 'retake_student_ids' | 'created_at'
>;
type ClassRow = { id: string; teacher_id: string; teachers?: ClassroomTeacher[] | null };
type SubRow = Pick<Submission, 'assignment_id' | 'student_id' | 'status' | 'total_score' | 'submitted_at'>;
type Student = { id: string; line_uid?: string };

export type TeacherSummary = {
  handedToday: number;
  toGrade: number;
  /** Assignments with hand-ins to grade (one = link straight to its grading page). */
  toGradeWorks: Array<{ id: string; isExam: boolean }>;
  remindRooms: number;
  remindStudents: number;
  remindAllQuizzes: boolean;
  pendingStudents: number;
  pendingRooms: string[];
};

const chunk = <T,>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size));

async function readAll<T>(run: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await run(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data || []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/** "2026-11-10" and the hour, in school time. */
export function schoolDay(now: Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: SCHOOL_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
      .formatToParts(now)
      .map((part) => [part.type, part.value])
  );
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return { date, hour: Number(parts.hour), startMs: Date.parse(`${date}T00:00:00+07:00`) };
}

/** Owner, co-teachers and TAs (not researchers) of a classroom. */
const staffOf = (room: ClassRow) =>
  [room.teacher_id, ...(room.teachers || []).filter((t) => t.role !== 'researcher').map((t) => t.teacher_id)].filter((id): id is string => !!id);

/**
 * Works out every teacher's summary in a few reads for all of them: recent
 * work, its classrooms and their students, and the hand-ins.
 */
export async function buildSummaries(supabase: Supabase, teacherIds: string[], now: Date): Promise<Map<string, TeacherSummary>> {
  const wanted = new Set(teacherIds);
  const nowMs = now.getTime();
  const { startMs } = schoolDay(now);
  const since = new Date(nowMs - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const [works, waiting] = await Promise.all([
    readAll<WorkRow>((from, to) => supabase.from('assignments').select(ASSIGNMENT_COLUMNS).gte('due_date', since).order('id').range(from, to)),
    readAll<{ classroom_id: string }>((from, to) =>
      supabase.from('classroom_students').select('classroom_id').eq('status', 'pending_approval').order('classroom_id').range(from, to)
    ),
  ]);
  const released = works.filter((work) => {
    const win = getAssignmentWindow(work, nowMs);
    return !win.isDraft && !win.isScheduled;
  });

  const roomIds = [...new Set([...released.map((work) => work.classroom_id), ...waiting.map((row) => row.classroom_id)])];
  const rooms = (
    await Promise.all(
      chunk(roomIds, 100).map((part) => readAll<ClassRow>((from, to) => supabase.from('classrooms').select('id, teacher_id, teachers').in('id', part).range(from, to)))
    )
  ).flat();
  const staffRooms = rooms.filter((room) => staffOf(room).some((id) => wanted.has(id)));
  const roomById = new Map(staffRooms.map((room) => [room.id, room]));
  const myWorks = released.filter((work) => roomById.has(work.classroom_id));

  const workRoomIds = [...new Set(myWorks.map((work) => work.classroom_id))];
  const [enrolled, subs] = await Promise.all([
    Promise.all(
      chunk(workRoomIds, 50).map((part) =>
        readAll<{ classroom_id: string; users: Student | Student[] | null }>((from, to) =>
          supabase.from('classroom_students').select('classroom_id, users(id, line_uid)').in('classroom_id', part).eq('status', 'active').order('classroom_id').range(from, to)
        )
      )
    ).then((parts) => parts.flat()),
    Promise.all(
      chunk(myWorks.map((work) => work.id), 50).map((part) =>
        readAll<SubRow>((from, to) =>
          supabase.from('submissions').select('assignment_id, student_id, status, total_score, submitted_at').in('assignment_id', part).order('id').range(from, to)
        )
      )
    ).then((parts) => parts.flat()),
  ]);

  const rosters = new Map<string, Student[]>();
  for (const row of enrolled) {
    const user = Array.isArray(row.users) ? row.users[0] : row.users;
    if (!user) continue;
    rosters.set(row.classroom_id, [...(rosters.get(row.classroom_id) || []), user]);
  }
  const subsByWork = new Map<string, SubRow[]>();
  for (const sub of subs) subsByWork.set(sub.assignment_id, [...(subsByWork.get(sub.assignment_id) || []), sub]);

  /** Per classroom: what its staff see. */
  type RoomTally = { handedToday: number; toGrade: number; toGradeWorks: Array<{ id: string; isExam: boolean }>; remindStudents: Set<string>; remindQuizOnly: boolean };
  const tallies = new Map<string, RoomTally>();
  const tallyOf = (roomId: string) => {
    let tally = tallies.get(roomId);
    if (!tally) tallies.set(roomId, (tally = { handedToday: 0, toGrade: 0, toGradeWorks: [], remindStudents: new Set(), remindQuizOnly: true }));
    return tally;
  };

  for (const work of myWorks) {
    const takers = rosterFor(work, rosters.get(work.classroom_id) || []);
    const keyOf = new Map<string, string>();
    for (const student of takers) for (const key of [student.id, student.line_uid]) if (key) keyOf.set(key, student.id);
    const mine = (subsByWork.get(work.id) || []).filter((sub) => keyOf.has(sub.student_id));
    const handed = mine.filter(isHandedIn);
    const tally = tallyOf(work.classroom_id);

    tally.handedToday += handed.filter((sub) => sub.submitted_at && Date.parse(sub.submitted_at) >= startMs).length;
    if (!work.is_survey) {
      const toGrade = handed.filter((sub) => !isGraded(sub)).length;
      tally.toGrade += toGrade;
      if (toGrade) tally.toGradeWorks.push({ id: work.id, isExam: !!work.is_exam });
    }

    const win = getAssignmentWindow(work, nowMs);
    if (win.acceptsSubmissions && win.deadline != null && win.deadline <= nowMs + REMIND_AHEAD_MS) {
      const done = new Set(mine.filter((sub) => isHandedIn(sub) || isGraded(sub)).map((sub) => keyOf.get(sub.student_id)));
      const missing = takers.filter((student) => !done.has(student.id));
      for (const student of missing) tally.remindStudents.add(student.id);
      if (missing.length && !work.is_exam) tally.remindQuizOnly = false;
    }
  }

  const waitingByRoom = new Map<string, number>();
  for (const row of waiting) if (roomById.has(row.classroom_id)) waitingByRoom.set(row.classroom_id, (waitingByRoom.get(row.classroom_id) || 0) + 1);

  const summaries = new Map<string, TeacherSummary>();
  for (const teacherId of wanted) {
    const summary: TeacherSummary = { handedToday: 0, toGrade: 0, toGradeWorks: [], remindRooms: 0, remindStudents: 0, remindAllQuizzes: true, pendingStudents: 0, pendingRooms: [] };
    for (const room of staffRooms) {
      if (!staffOf(room).includes(teacherId)) continue;
      const tally = tallies.get(room.id);
      if (tally) {
        summary.handedToday += tally.handedToday;
        summary.toGrade += tally.toGrade;
        summary.toGradeWorks.push(...tally.toGradeWorks);
        if (tally.remindStudents.size) {
          summary.remindRooms += 1;
          summary.remindStudents += tally.remindStudents.size;
          if (!tally.remindQuizOnly) summary.remindAllQuizzes = false;
        }
      }
      const pending = waitingByRoom.get(room.id) || 0;
      if (pending) {
        summary.pendingStudents += pending;
        summary.pendingRooms.push(room.id);
      }
    }
    summaries.set(teacherId, summary);
  }
  return summaries;
}

/** Web links open in the phone's own browser, where the teacher is usually signed in. */
const web = (path: string) => webUrl(`${path}${path.includes('?') ? '&' : '?'}openExternalBrowser=1`);

/** The card's rows: only what has something in it, so the card fits the day. */
export function summaryRows(summary: TeacherSummary): SummaryRow[] {
  const rows: SummaryRow[] = [];
  if (summary.handedToday || summary.toGrade) {
    const works = summary.toGradeWorks;
    const url =
      works.length === 1
        ? web(`/assignments/${encodeURIComponent(works[0].id)}/grading?from=works`)
        : web(`/works?grading=unfinished${works.length && works.every((work) => work.isExam) ? '&tab=quiz' : ''}`);
    rows.push(
      summary.handedToday
        ? { icon: { emoji: '📥' }, title: `งานที่ส่งวันนี้: ${summary.handedToday} ชิ้น`, detail: summary.toGrade ? `รอตรวจ: ${summary.toGrade} ชิ้น` : undefined, url }
        : { icon: { emoji: '📝' }, title: `รอตรวจ: ${summary.toGrade} ชิ้น`, url }
    );
  }
  if (summary.remindRooms) {
    rows.push({
      icon: { image: 'calendar' },
      title: `รอทวง ${summary.remindRooms} ห้อง`,
      detail: `ยังไม่ส่ง ${summary.remindStudents} คน`,
      url: web(`/works?status=open${summary.remindAllQuizzes ? '&tab=quiz' : ''}`),
    });
  }
  if (summary.pendingStudents) {
    rows.push({
      icon: { emoji: '🙋' },
      title: `รออนุมัติเข้าห้อง ${summary.pendingStudents} คน`,
      detail: summary.pendingRooms.length > 1 ? `${summary.pendingRooms.length} ห้อง` : undefined,
      url: web(summary.pendingRooms.length === 1 ? `/classrooms/${encodeURIComponent(summary.pendingRooms[0])}` : '/classrooms'),
    });
  }
  return rows;
}

/** The card for these rows (null when there is nothing to tell). */
export function summaryCard(rows: SummaryRow[]): FlexMessage | null {
  if (!rows.length) return null;
  const alt = rows.map((row) => [row.title, row.detail].filter(Boolean).join(' · ')).join('\n');
  return dailySummaryCard({ sections: [{ heading: 'ภารกิจ', rows }], url: web('/dashboard'), altText: `📋 สรุปประจำวัน\n${alt}` });
}

/** One teacher's card right now (the free "สรุป" reply, previews). */
export async function teacherSummaryCard(supabase: Supabase, teacherId: string, now = new Date()) {
  const summary = (await buildSummaries(supabase, [teacherId], now)).get(teacherId)!;
  const rows = summaryRows(summary);
  return { summary, rows, card: summaryCard(rows) };
}

type TeacherRow = {
  id: string;
  teacher_line_uid: string | null;
  line_bot_friend: boolean | null;
  first_name: string | null;
  last_name: string | null;
  institution: string | null;
  teacher_approval: string | null;
  line_daily_summary: boolean | null;
  line_daily_summary_on: string | null;
};

export type DailySummaryRun =
  | { skipped: 'not-time' | 'no-columns' | 'nobody'; detail?: string }
  | { sent: number; empty: number; quotaSkipped: number; failed: number };

/** The scheduler's step (every five minutes): sends today's summaries once the hour comes. */
export async function runDailySummary(supabase: Supabase, now = new Date()): Promise<DailySummaryRun> {
  if (process.env.LINE_DAILY_SUMMARY === 'off') return { skipped: 'not-time', detail: 'LINE_DAILY_SUMMARY=off' };
  const day = schoolDay(now);
  if (day.hour < DAILY_SUMMARY_HOUR || day.hour > LAST_HOUR) return { skipped: 'not-time' };

  const { data, error } = await supabase
    .from('users')
    .select('id, teacher_line_uid, line_bot_friend, first_name, last_name, institution, teacher_approval, line_daily_summary, line_daily_summary_on')
    .eq('role', 'teacher')
    .not('teacher_line_uid', 'is', null)
    .or(`line_daily_summary_on.is.null,line_daily_summary_on.lt.${day.date}`);
  if (error) {
    // Before supabase_daily_summary_update.sql: nothing to do yet.
    return { skipped: 'no-columns', detail: error.message };
  }
  const teachers = ((data || []) as TeacherRow[]).filter(
    (t) => t.teacher_line_uid && t.line_bot_friend !== false && t.line_daily_summary !== false && teacherAccessOf(t) === 'ok'
  );
  if (!teachers.length) return { skipped: 'nobody' };

  // Claim today for each teacher first: a run that overlaps this one finds them taken.
  const { data: claimed, error: claimError } = await supabase
    .from('users')
    .update({ line_daily_summary_on: day.date })
    .in('id', teachers.map((t) => t.id))
    .or(`line_daily_summary_on.is.null,line_daily_summary_on.lt.${day.date}`)
    .select('id');
  if (claimError) return { skipped: 'no-columns', detail: claimError.message };
  const mine = new Set((claimed || []).map((row) => row.id as string));
  const recipients = teachers.filter((t) => mine.has(t.id));
  if (!recipients.length) return { skipped: 'nobody' };

  const summaries = await buildSummaries(supabase, recipients.map((t) => t.id), now);
  const cards = recipients
    .map((t) => ({ to: t.teacher_line_uid as string, card: summaryCard(summaryRows(summaries.get(t.id)!)) }))
    .filter((item): item is { to: string; card: FlexMessage } => !!item.card);

  // One push = one message per teacher. Keep the reserve; undefined (unknown) lets LINE decide.
  const left = await messagesLeftThisMonth();
  const budget = left === null || left === undefined ? cards.length : Math.max(0, left - DAILY_SUMMARY_RESERVE);
  const sending = cards.slice(0, budget);

  let sent = 0;
  let failed = 0;
  let quotaHit = false;
  for (const item of sending) {
    if (quotaHit) break;
    try {
      await pushLineMessages(item.to, [item.card]);
      sent += 1;
    } catch (error) {
      failed += 1;
      if (isLineQuotaError(error)) quotaHit = true;
      console.error(isLineQuotaError(error) ? 'Daily summary stopped (monthly quota used up):' : 'Daily summary push failed:', error instanceof LineApiError ? error.message : error);
    }
  }
  return { sent, empty: recipients.length - cards.length, quotaSkipped: cards.length - sent - failed, failed };
}

/** "สรุป" in the 1:1 chat on/off for the daily push ("ปิดสรุป" / "เปิดสรุป"). */
export async function setDailySummary(supabase: Supabase, teacherId: string, on: boolean) {
  const { error } = await supabase.from('users').update({ line_daily_summary: on }).eq('id', teacherId);
  return !error;
}
