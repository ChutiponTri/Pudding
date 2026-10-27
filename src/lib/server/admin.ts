import 'server-only';
import { createHash } from 'node:crypto';
import { currentUser } from '@clerk/nextjs/server';
import { createServiceSupabaseClient } from '@/lib/supabase/server';

type Supabase = ReturnType<typeof createServiceSupabaseClient>;
// Rows of arbitrary tables; columns differ per table.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const envList = (name: string) =>
  (process.env[name] || '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);

/**
 * The signed-in Clerk user, if they are a platform admin. Admins are listed in
 * ADMIN_EMAILS (verified Clerk emails) or ADMIN_USER_IDS (Clerk user ids),
 * comma-separated. With neither set, nobody is an admin.
 */
export async function getAdmin() {
  const emails = envList('ADMIN_EMAILS');
  const ids = envList('ADMIN_USER_IDS');
  if (!emails.length && !ids.length) return null;
  const user = await currentUser();
  if (!user) return null;
  if (ids.includes(user.id.toLowerCase())) return user;
  const verified = user.emailAddresses
    .filter((e) => e.verification?.status === 'verified')
    .map((e) => e.emailAddress.toLowerCase());
  return verified.some((e) => emails.includes(e)) ? user : null;
}

/** Raw tables an admin can browse and export. */
export const ADMIN_TABLES = [
  'users',
  'courses',
  'classrooms',
  'classroom_students',
  'classroom_posts',
  'assignments',
  'questions',
  'submissions',
  'submission_answers',
  'submission_events',
  'attendance_sessions',
  'attendance_records',
] as const;
export type AdminTable = (typeof ADMIN_TABLES)[number];

/** Derived datasets built for analysis and model training. */
export const ADMIN_DATASETS = {
  grading_pairs: 'คำถาม + คำตอบนักเรียน + คะแนน/คอมเมนต์ครู (1 แถวต่อคำตอบ)',
  grading_chat: 'รูปแบบ chat fine-tune (messages) เฉพาะคำตอบที่ครูให้คะแนนแล้ว',
  proxy_activity: 'การส่งงาน/เช็คชื่อแทนเพื่อน (ใช้เครื่องของเพื่อน)',
  integrity: 'งานที่ถูกตรวจจับพฤติกรรมน่าสงสัย + เหตุการณ์ออกจากหน้าจอ',
} as const;
export type AdminDataset = keyof typeof ADMIN_DATASETS;

/** Login/connection secrets never leave the database, even for admins. */
const SECRET_COLUMN = /token|secret|password/i;
const stripSecrets = (row: Row) => Object.fromEntries(Object.entries(row).filter(([key]) => !SECRET_COLUMN.test(key)));

/** Every row of a table (PostgREST returns at most 1000 per request). */
export async function fetchAll(supabase: Supabase, table: string, columns = '*'): Promise<Row[]> {
  const pageSize = 1000;
  const rows: Row[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...((data || []) as unknown as Row[]));
    if (!data || data.length < pageSize) return rows;
  }
}

export async function loadTable(supabase: Supabase, table: AdminTable) {
  return (await fetchAll(supabase, table)).map(stripSecrets);
}

/** Stable pseudonym for a person so training data carries no names or LINE ids. */
const pseudonym = (id?: string | null) => (id ? `s_${createHash('sha256').update(id).digest('hex').slice(0, 12)}` : null);

/** users keyed by both users.id and LINE uid (rows reference either). */
function indexUsers(users: Row[]) {
  const byId = new Map<string, Row>();
  for (const user of users) {
    byId.set(user.id, user);
    if (user.line_uid) byId.set(user.line_uid, user);
  }
  return byId;
}
const fullName = (user?: Row) => (user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : '');

export async function loadDataset(supabase: Supabase, dataset: AdminDataset, anonymize: boolean): Promise<Row[]> {
  if (dataset === 'grading_pairs' || dataset === 'grading_chat') {
    const [answers, questions, submissions, assignments] = await Promise.all([
      fetchAll(supabase, 'submission_answers'),
      fetchAll(supabase, 'questions'),
      fetchAll(supabase, 'submissions'),
      fetchAll(supabase, 'assignments', 'id, classroom_id, title, description, is_exam'),
    ]);
    const questionById = new Map(questions.map((q) => [q.id, q]));
    const submissionById = new Map(submissions.map((s) => [s.id, s]));
    const assignmentById = new Map(assignments.map((a) => [a.id, a]));
    const pairs = answers.flatMap((answer) => {
      const question = questionById.get(answer.question_id);
      const submission = submissionById.get(answer.submission_id);
      if (!question || !submission) return [];
      const assignment = assignmentById.get(submission.assignment_id);
      return [
        {
          answer_id: answer.id,
          assignment_id: submission.assignment_id,
          assignment_title: assignment?.title || '',
          is_exam: !!assignment?.is_exam,
          question_id: question.id,
          question_type: question.type,
          question_text: question.question_text,
          options: question.options || null,
          ideal_answer: question.ideal_answer || null,
          rubric_criteria: question.rubric_criteria || null,
          max_score: question.max_score,
          student: anonymize ? pseudonym(submission.student_id) : submission.student_id,
          student_answer: answer.text_answer || '',
          file_url: answer.file_url || null,
          teacher_score: answer.teacher_score ?? null,
          teacher_comment: answer.teacher_comment || null,
          research_grades: answer.research_grades || null,
          ai_score: answer.ai_mock_score ?? null,
          ai_feedback: answer.ai_feedback || null,
          submission_status: submission.status,
          is_flagged_suspicious: !!submission.is_flagged_suspicious,
          sent_from_friend_phone: !!submission.submitted_by,
          submitted_at: submission.submitted_at,
        },
      ];
    });
    if (dataset === 'grading_pairs') return pairs;

    // Score-and-feedback prediction: only text answers a teacher actually graded.
    return pairs
      .filter((p) => p.teacher_score !== null && p.question_type !== 'file_upload' && p.student_answer.trim())
      .map((p) => ({
        messages: [
          {
            role: 'system',
            content: 'คุณเป็นครูผู้ตรวจงาน ให้คะแนนคำตอบของนักเรียนตามเกณฑ์ และเขียนคำแนะนำสั้น ๆ ตอบเป็น JSON {"score": number, "comment": string}',
          },
          {
            role: 'user',
            content: [
              `คำถาม: ${p.question_text}`,
              p.options ? `ตัวเลือก: ${JSON.stringify(p.options)}` : '',
              p.ideal_answer ? `คำตอบที่คาดหวัง: ${p.ideal_answer}` : '',
              p.rubric_criteria ? `เกณฑ์การให้คะแนน: ${p.rubric_criteria}` : '',
              `คะแนนเต็ม: ${p.max_score}`,
              `คำตอบของนักเรียน: ${p.student_answer}`,
            ]
              .filter(Boolean)
              .join('\n'),
          },
          { role: 'assistant', content: JSON.stringify({ score: p.teacher_score, comment: p.teacher_comment || '' }) },
        ],
      }));
  }

  if (dataset === 'proxy_activity') {
    const [submissions, records, users, assignments, sessions, classrooms] = await Promise.all([
      supabase.from('submissions').select('*').not('submitted_by', 'is', null),
      supabase.from('attendance_records').select('*').not('checked_in_by', 'is', null),
      fetchAll(supabase, 'users', 'id, line_uid, first_name, last_name, student_id'),
      fetchAll(supabase, 'assignments', 'id, title, classroom_id'),
      fetchAll(supabase, 'attendance_sessions', 'id, title, classroom_id'),
      fetchAll(supabase, 'classrooms', 'id, name, course_name'),
    ]);
    const userById = indexUsers(users);
    const assignmentById = new Map(assignments.map((a) => [a.id, a]));
    const sessionById = new Map(sessions.map((s) => [s.id, s]));
    const classroomById = new Map(classrooms.map((c) => [c.id, c]));
    const person = (id: string) =>
      anonymize
        ? { id: pseudonym(id) }
        : { id, name: fullName(userById.get(id)), student_number: userById.get(id)?.student_id || '' };
    const classroomName = (id?: string) => {
      const c = id ? classroomById.get(id) : undefined;
      return c ? [c.course_name, c.name].filter(Boolean).join(' • ') : '';
    };
    return [
      ...((submissions.data || []) as Row[]).map((s) => {
        const assignment = assignmentById.get(s.assignment_id);
        return {
          kind: 'submission',
          at: s.submitted_at,
          classroom: classroomName(assignment?.classroom_id),
          item: assignment?.title || s.assignment_id,
          status: s.status,
          for_student: person(s.student_id),
          phone_owner: person(s.submitted_by),
        };
      }),
      ...((records.data || []) as Row[]).map((r) => ({
        kind: 'attendance',
        at: r.checked_at,
        classroom: classroomName(r.classroom_id),
        item: sessionById.get(r.session_id)?.title || r.session_id,
        status: r.status,
        for_student: person(r.student_id),
        phone_owner: person(r.checked_in_by),
      })),
    ].sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  }

  // integrity
  const [{ data: flagged }, users, assignments] = await Promise.all([
    supabase.from('submissions').select('*').eq('is_flagged_suspicious', true),
    fetchAll(supabase, 'users', 'id, line_uid, first_name, last_name, student_id'),
    fetchAll(supabase, 'assignments', 'id, title'),
  ]);
  const flaggedRows = (flagged || []) as Row[];
  const { data: events } = flaggedRows.length
    ? await supabase.from('submission_events').select('*').in('submission_id', flaggedRows.map((s) => s.id))
    : { data: [] as Row[] };
  const userById = indexUsers(users);
  const assignmentById = new Map(assignments.map((a) => [a.id, a]));
  return flaggedRows.map((s) => ({
    submission_id: s.id,
    assignment: assignmentById.get(s.assignment_id)?.title || s.assignment_id,
    student: anonymize ? pseudonym(s.student_id) : fullName(userById.get(s.student_id)) || s.student_id,
    submitted_at: s.submitted_at,
    tab_switch_count: s.tab_switch_count,
    total_time_away_seconds: s.total_time_away_seconds,
    events: ((events || []) as Row[])
      .filter((e) => e.submission_id === s.id)
      .map((e) => ({ type: e.event_type, away_seconds: e.away_duration_seconds, at: e.created_at, details: e.details })),
  }));
}

/** Flattens rows to CSV (nested values as JSON), with a BOM so Excel reads Thai. */
export function toCsv(rows: Row[]) {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const cell = (value: unknown) => {
    const text = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    return `"${text.replaceAll('"', '""')}"`;
  };
  return '﻿' + [columns.map(cell).join(','), ...rows.map((row) => columns.map((c) => cell(row[c])).join(','))].join('\n');
}
