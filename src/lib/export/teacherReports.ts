import type { Assignment, Classroom, Question, Submission, SubmissionAnswer, User } from '@/types/database';
import type { Cell, Sheet } from '@/lib/export/xlsx';
import { classroomTitle, roomLabel, subjectTitle } from '@/lib/utils/classroomLabel';
import { getAssignmentWindow, isAssignmentDraft, isAssignmentPublished } from '@/lib/utils/assignmentWindow';
import { formatDateTime } from '@/lib/utils/datetime';
import { isRetake } from '@/lib/utils/retake';
import { isGraded, isHandedIn, isMissing, isStudentSubmission, needsGrading } from '@/lib/utils/gradingStatus';

/**
 * Builds the sheets of the teacher export page from fresh data
 * (dataService.getTeacherExportData). Pure functions: no fetching, no DOM.
 * Per-classroom grids (grade book, attendance) get one sheet per classroom;
 * row-per-item reports get one sheet with a classroom column, ready for
 * filters and pivot tables.
 */

export type ExportData = {
  classrooms: Classroom[];
  assignments: Assignment[];
  questions: Question[];
  submissions: Submission[];
  answers: SubmissionAnswer[];
  sessions: Array<{ id: string; classroom_id: string; title: string; starts_at: string; status: string }>;
  records: Array<{ session_id: string; classroom_id: string; student_id: string; status: string; checked_at: string | null; checked_in_by: string | null }>;
};

export type ReportId = 'gradebook' | 'attendance' | 'submissions' | 'question_scores' | 'roster' | 'missing';
export const REPORT_IDS: ReportId[] = ['gradebook', 'attendance', 'submissions', 'question_scores', 'roster', 'missing'];

type Lang = 'th' | 'en';
const t = (lang: Lang, th: string, en: string) => (lang === 'th' ? th : en);
const fullName = (s?: Partial<User>) => `${s?.first_name || ''} ${s?.last_name || ''}`.trim() || s?.name || '-';
const pointsOf = (a: Assignment) => a.total_points || 20;
const round1 = (n: number) => Math.round(n * 10) / 10;
const when = (iso: string | null | undefined, lang: Lang) => (iso ? formatDateTime(iso, lang) : '');

/**
 * Published work of a classroom in classroom order: by group, the teacher's
 * order, then oldest first. Retake quizzes are left out: their scores are in
 * the original quiz's column.
 */
function workOf(data: ExportData, classroomId: string) {
  return data.assignments
    .filter((a) => a.classroom_id === classroomId && !isAssignmentDraft(a) && isAssignmentPublished(a) && !isRetake(a))
    .sort(
      (a, b) =>
        (a.group_name || '').localeCompare(b.group_name || '') ||
        (a.sort_order ?? Number.MAX_SAFE_INTEGER) - (b.sort_order ?? Number.MAX_SAFE_INTEGER) ||
        new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
    );
}

function studentsOf(classroom: Classroom) {
  return [...(classroom.students || [])].sort((a, b) => (a.student_id || '').localeCompare(b.student_id || '', undefined, { numeric: true }) || fullName(a).localeCompare(fullName(b)));
}

const submissionsByAssignment = (data: ExportData) => {
  const map = new Map<string, Submission[]>();
  for (const s of data.submissions) {
    const list = map.get(s.assignment_id) || [];
    list.push(s);
    map.set(s.assignment_id, list);
  }
  return map;
};

const findSub = (byAssignment: Map<string, Submission[]>, assignmentId: string, student: User) =>
  (byAssignment.get(assignmentId) || []).find((s) => isStudentSubmission(s, student));

/** Short, unique-enough sheet name for a classroom. */
const sheetLabel = (prefix: string, c: Classroom) => `${prefix} ${roomLabel(c).replace(/^ห้อง\s*/, '') || subjectTitle(c)}`.slice(0, 31);

function statusText(sub: Submission | undefined, a: Assignment, lang: Lang) {
  if (!sub || isMissing(sub)) return getAssignmentWindow(a).acceptsSubmissions ? t(lang, 'ยังไม่ส่ง', 'Not yet') : t(lang, 'ไม่ส่ง', 'Missing');
  if (!isHandedIn(sub)) return t(lang, 'ไม่ส่ง (ครูให้คะแนน)', 'Missing (scored)');
  return sub.status === 'late' ? t(lang, 'ส่งช้า', 'Late') : t(lang, 'ส่งตรงเวลา', 'On time');
}

function gradebook(data: ExportData, lang: Lang): Sheet[] {
  const byAssignment = submissionsByAssignment(data);
  const summary: Cell[][] = [];
  const sheets = data.classrooms.map((c) => {
    const work = workOf(data, c.id);
    const maxTotal = work.reduce((sum, a) => sum + pointsOf(a), 0);
    const rows = studentsOf(c).map((student) => {
      let total = 0;
      let missing = 0;
      let toGrade = 0;
      const cells = work.map((a): Cell => {
        const sub = findSub(byAssignment, a.id, student);
        if (sub && isGraded(sub)) {
          total += Number(sub.total_score) || 0;
          return Number(sub.total_score);
        }
        if (sub && needsGrading(sub)) {
          toGrade++;
          return t(lang, 'รอตรวจ', 'To grade');
        }
        if (!getAssignmentWindow(a).acceptsSubmissions) missing++;
        return getAssignmentWindow(a).acceptsSubmissions ? '' : t(lang, 'ไม่ส่ง', 'Missing');
      });
      total = round1(total);
      const percent = maxTotal ? round1((total / maxTotal) * 100) : null;
      summary.push([classroomTitle(c), student.student_id || '', fullName(student), total, maxTotal, percent, missing, toGrade]);
      return [student.student_id || '', fullName(student), ...cells, total, maxTotal, percent, missing, toGrade];
    });
    return {
      name: sheetLabel(t(lang, 'คะแนน', 'Grades'), c),
      header: [
        t(lang, 'รหัสนักเรียน', 'Student ID'),
        t(lang, 'ชื่อ-นามสกุล', 'Full name'),
        ...work.map((a) => `${a.is_exam ? t(lang, '[ข้อสอบ] ', '[Exam] ') : ''}${a.title} (${t(lang, 'เต็ม', 'of')} ${pointsOf(a)})`),
        t(lang, 'คะแนนรวม', 'Total'),
        t(lang, 'คะแนนเต็ม', 'Max'),
        t(lang, 'ร้อยละ', 'Percent'),
        t(lang, 'ไม่ส่ง (งาน)', 'Missing'),
        t(lang, 'รอตรวจ (งาน)', 'To grade'),
      ],
      rows,
      widths: [14, 26, ...work.map(() => 14), 10, 10, 8, 10, 10],
    } satisfies Sheet;
  });
  return [
    {
      name: t(lang, 'สรุปคะแนน', 'Grade summary'),
      header: [t(lang, 'ห้องเรียน', 'Classroom'), t(lang, 'รหัสนักเรียน', 'Student ID'), t(lang, 'ชื่อ-นามสกุล', 'Full name'), t(lang, 'คะแนนรวม', 'Total'), t(lang, 'คะแนนเต็ม', 'Max'), t(lang, 'ร้อยละ', 'Percent'), t(lang, 'ไม่ส่ง (งาน)', 'Missing'), t(lang, 'รอตรวจ (งาน)', 'To grade')],
      rows: summary,
    },
    ...sheets,
  ];
}

const ATTENDANCE: Record<string, { th: string; en: string }> = {
  on_time: { th: 'มา', en: 'Present' },
  late: { th: 'สาย', en: 'Late' },
  absent: { th: 'ขาด', en: 'Absent' },
  excused: { th: 'ลา', en: 'Excused' },
};

function attendance(data: ExportData, lang: Lang): Sheet[] {
  const summary: Cell[][] = [];
  const sheets = data.classrooms.map((c) => {
    const sessions = data.sessions
      .filter((s) => s.classroom_id === c.id && s.status !== 'scheduled')
      .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
    const bySession = new Map<string, Map<string, string>>();
    for (const r of data.records) {
      if (r.classroom_id !== c.id) continue;
      const m = bySession.get(r.session_id) || new Map<string, string>();
      m.set(r.student_id, r.status);
      bySession.set(r.session_id, m);
    }
    const rows = studentsOf(c).map((student) => {
      const statuses = sessions.map((s) => {
        const m = bySession.get(s.id);
        const status = m?.get(student.id) || (student.line_uid ? m?.get(student.line_uid) : undefined) || (student.student_id ? m?.get(student.student_id) : undefined);
        // An open period without a record is still waiting; a closed one counts as absent.
        return status || (s.status === 'open' ? '' : 'absent');
      });
      const count = (key: string) => statuses.filter((s) => s === key).length;
      const counted = statuses.filter(Boolean).length;
      const present = count('on_time') + count('late');
      const rate = counted ? round1((present / counted) * 100) : null;
      summary.push([classroomTitle(c), student.student_id || '', fullName(student), count('on_time'), count('late'), count('absent'), count('excused'), counted, rate]);
      return [
        student.student_id || '',
        fullName(student),
        ...statuses.map((s) => (s ? ATTENDANCE[s]?.[lang] || s : '')),
        count('on_time'),
        count('late'),
        count('absent'),
        count('excused'),
        rate,
      ];
    });
    return {
      name: sheetLabel(t(lang, 'เช็คชื่อ', 'Attend'), c),
      header: [
        t(lang, 'รหัสนักเรียน', 'Student ID'),
        t(lang, 'ชื่อ-นามสกุล', 'Full name'),
        ...sessions.map((s) => `${s.title} (${when(s.starts_at, lang)})`),
        ATTENDANCE.on_time[lang],
        ATTENDANCE.late[lang],
        ATTENDANCE.absent[lang],
        ATTENDANCE.excused[lang],
        t(lang, '% มาเรียน', '% present'),
      ],
      rows,
      widths: [14, 26, ...sessions.map(() => 12), 8, 8, 8, 8, 10],
    } satisfies Sheet;
  });
  return [
    {
      name: t(lang, 'สรุปเช็คชื่อ', 'Attendance summary'),
      header: [t(lang, 'ห้องเรียน', 'Classroom'), t(lang, 'รหัสนักเรียน', 'Student ID'), t(lang, 'ชื่อ-นามสกุล', 'Full name'), ATTENDANCE.on_time[lang], ATTENDANCE.late[lang], ATTENDANCE.absent[lang], ATTENDANCE.excused[lang], t(lang, 'คาบทั้งหมด', 'Periods'), t(lang, '% มาเรียน', '% present')],
      rows: summary,
    },
    ...sheets,
  ];
}

function submissionLog(data: ExportData, lang: Lang): Sheet {
  const byAssignment = submissionsByAssignment(data);
  const nameById = new Map<string, string>();
  for (const c of data.classrooms) for (const s of c.students || []) nameById.set(s.id, fullName(s));
  const rows: Cell[][] = [];
  for (const c of data.classrooms) {
    for (const a of workOf(data, c.id)) {
      for (const student of studentsOf(c)) {
        const sub = findSub(byAssignment, a.id, student);
        rows.push([
          classroomTitle(c),
          a.group_name || '',
          a.title,
          a.is_exam ? t(lang, 'ข้อสอบ', 'Exam') : t(lang, 'งาน', 'Work'),
          when(getAssignmentWindow(a).deadline ? new Date(getAssignmentWindow(a).deadline!).toISOString() : a.due_date, lang),
          student.student_id || '',
          fullName(student),
          statusText(sub, a, lang),
          when(sub && isHandedIn(sub) ? sub.submitted_at : null, lang),
          sub && isGraded(sub) ? Number(sub.total_score) : null,
          pointsOf(a),
          (sub && needsGrading(sub) ? t(lang, 'รอตรวจ', 'To grade') : sub && isGraded(sub) ? t(lang, 'ตรวจแล้ว', 'Graded') : '') +
            (sub?.retake_submission_id ? t(lang, ' (คะแนนสอบซ่อม)', ' (retake score)') : ''),
          sub?.reopened_at ? t(lang, 'เปิดให้แก้ไขอยู่', 'Editing allowed') : '',
          sub?.submitted_by ? nameById.get(sub.submitted_by) || sub.submitted_by : '',
          a.is_exam && sub ? sub.tab_switch_count || 0 : null,
          a.is_exam && sub?.is_flagged_suspicious
            ? t(lang, 'น่าสงสัย', 'Flagged') +
              (sub.quiz_exit_count ? t(lang, ` (ปิดข้อสอบ ${sub.quiz_exit_count} ครั้ง)`, ` (closed quiz ${sub.quiz_exit_count}×)`) : '') +
              (sub.auto_forfeited ? t(lang, ' ส่งเปล่าอัตโนมัติ', ' auto blank') : '')
            : '',
        ]);
      }
    }
  }
  return {
    name: t(lang, 'การส่งงาน', 'Submissions'),
    header: [
      t(lang, 'ห้องเรียน', 'Classroom'), t(lang, 'หมวด', 'Group'), t(lang, 'งาน', 'Assignment'), t(lang, 'ประเภท', 'Type'), t(lang, 'กำหนดส่ง', 'Due'),
      t(lang, 'รหัสนักเรียน', 'Student ID'), t(lang, 'ชื่อ-นามสกุล', 'Full name'), t(lang, 'สถานะ', 'Status'), t(lang, 'ส่งเมื่อ', 'Submitted at'),
      t(lang, 'คะแนน', 'Score'), t(lang, 'คะแนนเต็ม', 'Max'), t(lang, 'การตรวจ', 'Grading'), t(lang, 'แก้ไขงาน', 'Edit'),
      t(lang, 'ส่งจากเครื่องของ', 'Sent from phone of'), t(lang, 'ออกจากจอ (ครั้ง)', 'Left screen'), t(lang, 'ความผิดปกติ', 'Integrity'),
    ],
    rows,
  };
}

function questionScores(data: ExportData, lang: Lang): Sheet {
  const questionsByAssignment = new Map<string, Question[]>();
  for (const q of data.questions) {
    const list = questionsByAssignment.get(q.assignment_id) || [];
    list.push(q);
    questionsByAssignment.set(q.assignment_id, list);
  }
  const answerOf = new Map(data.answers.map((a) => [`${a.submission_id}|${a.question_id}`, a]));
  const byAssignment = submissionsByAssignment(data);
  const rows: Cell[][] = [];
  for (const c of data.classrooms) {
    for (const a of workOf(data, c.id)) {
      const questions = questionsByAssignment.get(a.id) || [];
      for (const student of studentsOf(c)) {
        const sub = findSub(byAssignment, a.id, student);
        if (!sub || !isHandedIn(sub)) continue;
        questions.forEach((q, i) => {
          const ans = answerOf.get(`${sub.id}|${q.id}`);
          rows.push([
            classroomTitle(c), a.title, i + 1, q.type, q.question_text, Number(q.max_score) || 0,
            student.student_id || '', fullName(student),
            ans?.teacher_score ?? null, ans?.teacher_comment || '', when(ans?.graded_at, lang),
          ]);
        });
      }
    }
  }
  return {
    name: t(lang, 'คะแนนรายข้อ', 'Question scores'),
    header: [
      t(lang, 'ห้องเรียน', 'Classroom'), t(lang, 'งาน', 'Assignment'), t(lang, 'ข้อที่', 'Q#'), t(lang, 'ประเภทคำถาม', 'Question type'),
      t(lang, 'คำถาม', 'Question'), t(lang, 'คะแนนเต็ม', 'Max'), t(lang, 'รหัสนักเรียน', 'Student ID'), t(lang, 'ชื่อ-นามสกุล', 'Full name'),
      t(lang, 'คะแนน', 'Score'), t(lang, 'ความเห็นครู', 'Comment'), t(lang, 'ตรวจเมื่อ', 'Graded at'),
    ],
    rows,
    widths: [24, 24, 6, 14, 40, 8, 14, 24, 8, 30, 16],
  };
}

function roster(data: ExportData, lang: Lang): Sheet {
  const rows: Cell[][] = [];
  for (const c of data.classrooms) {
    for (const s of studentsOf(c)) rows.push([classroomTitle(c), s.student_id || '', s.first_name || '', s.last_name || '', s.institution || '', s.email || '', t(lang, 'อยู่ในห้อง', 'Admitted'), s.line_uid ? t(lang, 'เชื่อมแล้ว', 'Linked') : '']);
    for (const s of c.pending_students || []) rows.push([classroomTitle(c), s.student_id || '', s.first_name || '', s.last_name || '', s.institution || '', s.email || '', t(lang, 'รออนุมัติ', 'Pending'), s.line_uid ? t(lang, 'เชื่อมแล้ว', 'Linked') : '']);
  }
  return {
    name: t(lang, 'รายชื่อนักเรียน', 'Roster'),
    header: [t(lang, 'ห้องเรียน', 'Classroom'), t(lang, 'รหัสนักเรียน', 'Student ID'), t(lang, 'ชื่อ', 'First name'), t(lang, 'นามสกุล', 'Last name'), t(lang, 'สถานศึกษา', 'School'), t(lang, 'อีเมล', 'Email'), t(lang, 'สถานะ', 'Status'), 'LINE'],
    rows,
  };
}

function missing(data: ExportData, lang: Lang): Sheet {
  const byAssignment = submissionsByAssignment(data);
  const rows: Cell[][] = [];
  for (const c of data.classrooms) {
    for (const a of workOf(data, c.id)) {
      const window = getAssignmentWindow(a);
      if (!window.isPastDeadline) continue;
      for (const student of studentsOf(c)) {
        const sub = findSub(byAssignment, a.id, student);
        if (!isMissing(sub)) continue;
        rows.push([
          classroomTitle(c), a.title, a.is_exam ? t(lang, 'ข้อสอบ', 'Exam') : t(lang, 'งาน', 'Work'),
          when(window.deadline ? new Date(window.deadline).toISOString() : a.due_date, lang),
          window.acceptsSubmissions ? t(lang, 'ยังส่งช้าได้', 'Late still accepted') : t(lang, 'ปิดรับแล้ว', 'Closed'),
          student.student_id || '', fullName(student),
        ]);
      }
    }
  }
  return {
    name: t(lang, 'งานค้างส่ง', 'Missing work'),
    header: [t(lang, 'ห้องเรียน', 'Classroom'), t(lang, 'งาน', 'Assignment'), t(lang, 'ประเภท', 'Type'), t(lang, 'กำหนดส่ง', 'Due'), t(lang, 'สถานะงาน', 'Work status'), t(lang, 'รหัสนักเรียน', 'Student ID'), t(lang, 'ชื่อ-นามสกุล', 'Full name')],
    rows,
  };
}

/** The sheets for the chosen reports, in a fixed order. */
export function buildReports(data: ExportData, reports: ReportId[], lang: Lang): Sheet[] {
  const want = new Set(reports);
  return [
    ...(want.has('gradebook') ? gradebook(data, lang) : []),
    ...(want.has('attendance') ? attendance(data, lang) : []),
    ...(want.has('submissions') ? [submissionLog(data, lang)] : []),
    ...(want.has('question_scores') ? [questionScores(data, lang)] : []),
    ...(want.has('missing') ? [missing(data, lang)] : []),
    ...(want.has('roster') ? [roster(data, lang)] : []),
  ];
}
