import 'server-only';
import type { createServiceSupabaseClient } from '@/lib/supabase/server';

type Supabase = ReturnType<typeof createServiceSupabaseClient>;

/**
 * One trip away from the quiz screen, saved on the server while it happens
 * (POST /api/quiz-attempts/away), so closing LINE cannot erase it. Sent when
 * the trip starts (duration 0) and again when the student comes back.
 */
export interface AwayEvent {
  /** Chosen by the phone, one per trip; the second report updates the first. */
  id: string;
  event_type: TrackedEventType;
  /** ISO time the trip started. */
  started_at: string;
  duration_seconds: number;
  details?: string;
}

/** Trips away from the quiz: counted, timed, and flagged when frequent or long. */
export const AWAY_TRIP_TYPES = ['tab_hidden', 'window_blur', 'split_screen'] as const;
/**
 * Everything the quiz reports live. Besides trips: the desktop pointer leaving
 * the window for a while (e.g. to a second monitor) and copy / paste — shown to
 * the teacher; only a paste flags the hand-in (see submissions route).
 */
export const AWAY_EVENT_TYPES = [...AWAY_TRIP_TYPES, 'pointer_left', 'copy_attempt', 'paste_attempt'] as const;
export type TrackedEventType = (typeof AWAY_EVENT_TYPES)[number];
const isTrip = (e: { event_type: string }) => (AWAY_TRIP_TYPES as readonly string[]).includes(e.event_type);
const MAX_AWAY_EVENTS = 300;

/** A student's openings of one quiz (see quizExit.ts). */
export interface QuizAttempt {
  openCount: number;
  /** Times the quiz was left without handing in: every opening after the first. */
  exits: number;
  /** ISO time of every opening, oldest first. */
  openedAt: string[];
  /** Trips away saved live (empty on databases without supabase_quiz_away_update.sql). */
  awayEvents: AwayEvent[];
}

const isMissingAwayColumn = (error: { message?: string; code?: string } | null) =>
  !!error && (error.code === '42703' || /away_events/.test(error.message || ''));

const parseAwayEvents = (value: unknown): AwayEvent[] =>
  Array.isArray(value)
    ? (value as AwayEvent[]).filter(
        (e) => e && typeof e.id === 'string' && typeof e.started_at === 'string' && (AWAY_EVENT_TYPES as readonly string[]).includes(e.event_type)
      )
    : [];

const attemptId = (assignmentId: string, studentId: string) => `att-${assignmentId}-${studentId}`;

/** Databases without supabase_quiz_exit_update.sql: openings are simply not counted. */
const isMissingTable = (error: { message?: string; code?: string } | null) =>
  !!error && (error.code === '42P01' || error.code === 'PGRST205' || /quiz_attempts/.test(error.message || ''));

/**
 * How often the student has opened (and left) the quiz so far; no row = never
 * opened. null when the database cannot count openings yet.
 */
export async function readQuizAttempt(supabase: Supabase, assignmentId: string, studentId: string): Promise<QuizAttempt | null> {
  const id = attemptId(assignmentId, studentId);
  let { data, error } = await supabase.from('quiz_attempts').select('open_count, opened_at, away_events').eq('id', id).maybeSingle();
  if (isMissingAwayColumn(error)) {
    ({ data, error } = await supabase.from('quiz_attempts').select('open_count, opened_at').eq('id', id).maybeSingle());
  }
  if (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
  const row = data as { open_count?: number; opened_at?: unknown; away_events?: unknown } | null;
  const openCount = Math.max(0, Number(row?.open_count || 0));
  const openedAt = Array.isArray(row?.opened_at) ? (row.opened_at as unknown[]).filter((t): t is string => typeof t === 'string') : [];
  return { openCount, exits: Math.max(0, openCount - 1), openedAt, awayEvents: parseAwayEvents(row?.away_events) };
}

/**
 * Counts one more opening of the quiz; null when the database cannot count openings yet.
 * Pass `current` when it was already read (saves a round trip).
 */
export async function recordQuizOpen(
  supabase: Supabase,
  assignmentId: string,
  studentId: string,
  known?: QuizAttempt | null
): Promise<QuizAttempt | null> {
  const current = known === undefined ? await readQuizAttempt(supabase, assignmentId, studentId) : known;
  if (!current) return null;
  const now = new Date().toISOString();
  const openCount = current.openCount + 1;
  const openedAt = [...current.openedAt, now];
  const { error } = await supabase.from('quiz_attempts').upsert({
    id: attemptId(assignmentId, studentId),
    assignment_id: assignmentId,
    student_id: studentId,
    open_count: openCount,
    opened_at: openedAt,
    updated_at: now,
  });
  if (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
  return { openCount, exits: openCount - 1, openedAt, awayEvents: current.awayEvents };
}

/**
 * Saves (or updates) one trip away. false when the database cannot keep them
 * yet (no quiz_attempts table or no away_events column): the trip is then
 * only reported with the hand-in, as before.
 */
export async function recordAwayEvent(supabase: Supabase, assignmentId: string, studentId: string, event: AwayEvent): Promise<boolean> {
  const current = await readQuizAttempt(supabase, assignmentId, studentId);
  if (!current) return false;
  const others = current.awayEvents.filter((e) => e.id !== event.id);
  const previous = current.awayEvents.find((e) => e.id === event.id);
  // A late "started" report never shortens a trip already reported as ended.
  const merged = previous && previous.duration_seconds > event.duration_seconds ? previous : event;
  const awayEvents = [...others, merged].sort((a, b) => a.started_at.localeCompare(b.started_at)).slice(-MAX_AWAY_EVENTS);
  const { error } = await supabase.from('quiz_attempts').upsert({
    id: attemptId(assignmentId, studentId),
    assignment_id: assignmentId,
    student_id: studentId,
    open_count: current.openCount,
    opened_at: current.openedAt,
    away_events: awayEvents,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    if (isMissingTable(error) || isMissingAwayColumn(error)) return false;
    throw error;
  }
  return true;
}

/**
 * The trips away for a hand-in: those saved live on the server and those the
 * phone reports, together (same id = same trip, the longer report wins). A
 * trip that never reported its end (LINE was closed) lasts until the quiz was
 * next opened, or until the hand-in.
 */
export function mergeAwayEvents(
  saved: AwayEvent[],
  reported: Array<{ id?: string; event_type: string; timestamp?: string; duration_seconds?: number; details?: string }>,
  openedAt: string[],
  handedInAt: Date
): { events: AwayEvent[]; count: number; seconds: number; pastes: number } {
  const byId = new Map<string, AwayEvent>();
  for (const e of saved) byId.set(e.id, e);
  reported.forEach((e, i) => {
    if (!(AWAY_EVENT_TYPES as readonly string[]).includes(e.event_type)) return;
    const id = e.id || `client-${e.timestamp || i}`;
    const event: AwayEvent = {
      id,
      event_type: e.event_type as AwayEvent['event_type'],
      started_at: e.timestamp || handedInAt.toISOString(),
      duration_seconds: Math.max(0, Math.round(Number(e.duration_seconds || 0))),
      details: e.details,
    };
    const previous = byId.get(id);
    byId.set(id, previous && previous.duration_seconds >= event.duration_seconds ? previous : event);
  });
  const events = [...byId.values()]
    .sort((a, b) => a.started_at.localeCompare(b.started_at))
    .map((e) => {
      if (e.duration_seconds > 0 || !isTrip(e)) return e;
      const start = Date.parse(e.started_at);
      const nextOpen = openedAt.map((t) => Date.parse(t)).find((t) => t > start);
      const end = nextOpen ?? handedInAt.getTime();
      const seconds = Number.isFinite(start) ? Math.max(1, Math.round((end - start) / 1000)) : 1;
      return {
        ...e,
        duration_seconds: seconds,
        details: `${e.details || ''}${nextOpen ? ' (ปิดแอประหว่างออกจากหน้าจอ — นับถึงตอนเปิดข้อสอบอีกครั้ง)' : ''}`.trim(),
      };
    });
  const trips = events.filter(isTrip);
  return {
    events,
    count: trips.length,
    seconds: trips.reduce((sum, e) => sum + e.duration_seconds, 0),
    pastes: events.filter((e) => e.event_type === 'paste_attempt').length,
  };
}

/**
 * Opened again after leaving more often than warned: the blank sheet (0 on
 * every question) is handed in right here, in the same request as the
 * opening, instead of a second full hand-in from the phone. Same row and
 * events as POST /api/submissions writes for a forfeited quiz.
 */
export async function handInBlankQuiz(
  supabase: Supabase,
  args: {
    assignmentId: string;
    studentId: string;
    questions: Array<{ id: string; max_score?: number | null }>;
    attempt: QuizAttempt;
    existing: Record<string, unknown> | null;
    isPastDeadline: boolean;
    submittedBy: string | null;
  }
) {
  const { assignmentId, studentId, questions, attempt, existing, isPastDeadline, submittedBy } = args;
  const subId = (existing?.id as string | undefined) || `sub-${assignmentId}-${studentId}`;
  const now = new Date();
  const away = mergeAwayEvents(attempt.awayEvents, [], attempt.openedAt, now);
  const maxTotal = questions.reduce((sum, q) => sum + Number(q.max_score || 0), 0) || 20;
  const row: Record<string, unknown> = {
    id: subId,
    assignment_id: assignmentId,
    student_id: studentId,
    status: isPastDeadline ? 'late' : 'submitted',
    started_at: new Date(now.getTime() - 120000).toISOString(),
    submitted_at: now.toISOString(),
    time_spent_seconds: 120,
    tab_switch_count: away.count,
    total_time_away_seconds: away.seconds,
    is_flagged_suspicious: true,
    total_score: 0,
    max_total_score: maxTotal,
    quiz_exit_count: attempt.exits,
    auto_forfeited: true,
    ...(submittedBy ? { submitted_by: submittedBy } : {}),
    ...(existing && 'reopened_at' in existing ? { reopened_at: null } : {}),
    ...(existing && 'reopen_until' in existing ? { reopen_until: null } : {}),
  };
  let { error } = await supabase.from('submissions').upsert(row);
  if (error?.message?.includes('submitted_by')) {
    const { submitted_by: _unused, ...withoutSender } = row;
    ({ error } = await supabase.from('submissions').upsert(withoutSender));
  }
  if (error) throw error;

  const reopenedAt = attempt.openedAt.slice(1);
  await Promise.all([
    away.events.length
      ? supabase
          .from('submission_events')
          .upsert(
            away.events.map((e) => ({
              id: `evt-${subId}-away-${e.id}`,
              submission_id: subId,
              event_type: e.event_type,
              away_duration_seconds: e.duration_seconds,
              created_at: e.started_at,
              details: e.details || null,
            }))
          )
          .then(({ error: awayError }) => {
            if (awayError) console.warn('[handInBlankQuiz] away event write warning:', awayError);
          })
      : Promise.resolve(),
    (async () => {
      // A row the teacher recorded earlier may carry old answers: the blank sheet replaces them.
      if (existing) {
        const { error: clearError } = await supabase.from('submission_answers').delete().eq('submission_id', subId);
        if (clearError) throw clearError;
      }
      if (!questions.length) return;
      const { error: answerError } = await supabase.from('submission_answers').upsert(
        questions.map((q) => ({
          id: `ans-${subId}-${q.id}`,
          submission_id: subId,
          question_id: q.id,
          text_answer: '',
          file_url: null,
          teacher_score: 0,
        })),
        { onConflict: 'submission_id,question_id' }
      );
      if (answerError) throw answerError;
    })(),
    reopenedAt.length
      ? supabase
          .from('submission_events')
          .insert(
            reopenedAt.map((at, i) => ({
              id: `evt-${subId}-reopen-${i + 1}`,
              submission_id: subId,
              event_type: 'quiz_reopened',
              away_duration_seconds: 0,
              created_at: at,
              details:
                i === reopenedAt.length - 1
                  ? `ปิดข้อสอบแล้วเปิดใหม่ ครั้งที่ ${i + 1} — เกินจำนวนที่เตือนไว้ ระบบส่งกระดาษเปล่าอัตโนมัติ (0 คะแนน)`
                  : `ปิดข้อสอบแล้วเปิดใหม่ ครั้งที่ ${i + 1} (เตือนแล้ว)`,
            }))
          )
          .then(({ error: eventError }) => {
            // Supplementary: the hand-in itself is saved.
            if (eventError) console.warn('[handInBlankQuiz] reopen event write warning:', eventError);
          })
      : Promise.resolve(),
  ]);
  return { ...row, id: subId, answers: questions.map((q) => ({ question_id: q.id, answer_text: '', file_url: null })) };
}
