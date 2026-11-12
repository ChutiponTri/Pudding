import { after, NextRequest, NextResponse } from 'next/server';
import { signalClassroom } from '@/lib/realtime/classroomSignal';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { getAssignmentWindow, QUIZ_LATE_GRACE_MS } from '@/lib/utils/assignmentWindow';
import { formatDateTime, SCHOOL_TIME_ZONE } from '@/lib/utils/datetime';
import { isObjectiveQuestion, scoreObjectiveAnswer } from '@/lib/utils/autoGrade';
import { decodeChecks, encodeChecks, isSurvey, scaleValue } from '@/lib/utils/survey';
import { isSuspiciousActivity } from '@/lib/utils/integrity';
import { getActor } from '@/lib/auth/actor';
import { classroomRole, HttpError, isTeacherOf, loadClassroom } from '@/lib/server/access';
import { resolveProxyStudent, type ProxyStudent } from '@/lib/server/proxyStudent';
import { attachFiles, discardDrafts, keysFromUrls, removeFiles } from '@/lib/storage/files';
import { hasAnyAnswer, isHandedIn, isReopenActive, REOPEN_GRACE_MS } from '@/lib/utils/gradingStatus';
import { normalizeLink, onBehalfTag } from '@/lib/storage/uploadRules';
import { maskSubmission, resultRelease, resultReleaseForSubmissions } from '@/lib/server/resultRelease';
import { isRetake, retakeIncludes } from '@/lib/utils/retake';
import { syncRetakeScores } from '@/lib/server/retake';
import { mergeAwayEvents, readQuizAttempt, type QuizAttempt } from '@/lib/server/quizAttempts';
import { quizOpenAction } from '@/lib/utils/quizExit';
import { groupOfStudent, isGroupWork, syncGroupCopies } from '@/lib/server/workGroups';
import type { Classroom, Question, Submission } from '@/types/database';

/** What the student's browser sends; the body is untrusted, so only these fields are read. */
type IncomingAnswer = { question_id: string; answer_text?: string; file_url?: string };
type IncomingEvent = { id?: string; event_type: string; timestamp?: string; duration_seconds?: number; details?: string };
type SubmissionRow = Record<string, unknown> & { student_id: string; submitted_by?: string | null };
type StudentProfile = { id: string; first_name?: string | null; last_name?: string | null; line_uid?: string | null };

/**
 * Whether a multiple-choice answer is right. The answer key may be the option
 * text or its letter/number (ก/ข/…, A/B/…, 1/2/…). Text must match exactly
 * (ignoring case and spacing); "10" is not "100".
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/submissions?assignmentIds=a,b[&studentIds=x,y][&students=0]
 * Submissions for the given assignments, with each student's profile attached
 * unless students=0 (counts and scores only).
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const list = (value: string | null) => (value || '').split(',').map((id) => id.trim()).filter(Boolean);
  const assignmentIds = list(params.get('assignmentIds') || params.get('assignmentId'));
  const studentIds = list(params.get('studentIds'));
  const withStudents = params.get('students') !== '0';

  if (assignmentIds.length === 0) {
    return NextResponse.json({ error: 'assignmentIds is required' }, { status: 400 });
  }

  let supabase: ReturnType<typeof createServiceSupabaseClient>;
  try {
    supabase = createServiceSupabaseClient();
  } catch (configErr) {
    console.error('[GET /api/submissions] Supabase is not configured:', configErr);
    return NextResponse.json({ error: 'Database is not configured' }, { status: 503 });
  }

  // Teachers: only assignments in classrooms they teach. Students: only their own work.
  const actor = await getActor(request);
  if (!actor) return NextResponse.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 });
  let allowedIds = assignmentIds;
  if (actor.kind === 'teacher') {
    // Each assignment carries its classroom's teachers, so one round trip decides.
    const { data: rows } = await supabase
      .from('assignments')
      .select('id, classroom:classrooms(teacher_id, teachers)')
      .in('id', assignmentIds);
    type Row = { id: string; classroom: Pick<Classroom, 'teacher_id' | 'teachers'> | null };
    allowedIds = ((rows || []) as unknown as Row[])
      .filter((r) => r.classroom && isTeacherOf(r.classroom, actor.userId))
      .map((r) => r.id);
    if (!allowedIds.length) return NextResponse.json({ submissions: [] });
  }
  let query = supabase.from('submissions').select('*').in('assignment_id', allowedIds);
  if (actor.kind === 'student') query = query.in('student_id', actor.keys);
  else if (studentIds.length > 0) query = query.in('student_id', studentIds);
  const { data, error } = await query;
  if (error) {
    console.error('[GET /api/submissions] query failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  let submissions = (data || []) as SubmissionRow[];
  if (actor.kind === 'student' && submissions.length > 0) {
    // Choice / true-false results stay hidden until nobody can hand in any more.
    const release = await resultReleaseForSubmissions(supabase, submissions as unknown as Array<Pick<Submission, 'assignment_id' | 'status' | 'total_score'>>);
    submissions = submissions.map((sub) => (release.hidden.has(sub.assignment_id as string) ? (maskSubmission(sub as Partial<Submission>) as unknown as SubmissionRow) : sub));
  }
  if (!withStudents || submissions.length === 0) {
    return NextResponse.json({ submissions });
  }

  // Attach each student's real profile. submissions.student_id is users.id
  // (usually the LINE user id), so without this the teacher UI showed the raw
  // LINE id instead of the student's name, student number and photo.
  // Work sent from a classmate's phone also names that classmate.
  const ids = [...new Set(submissions.flatMap((s) => [s.student_id, s.submitted_by]).filter(Boolean))] as string[];
  const quoted = ids.map((id) => `"${id.replace(/["\\]/g, '')}"`).join(',');
  const { data: users, error: usersError } = await supabase
    .from('users')
    .select('id, first_name, last_name, student_id, avatar_url, line_uid, email, institution')
    .or(`id.in.(${quoted}),line_uid.in.(${quoted})`);
  if (usersError) console.warn('[GET /api/submissions] student lookup failed:', usersError.message);

  const byId = new Map<string, StudentProfile>();
  for (const user of users || []) {
    byId.set(user.id, user);
    if (user.line_uid) byId.set(user.line_uid, user);
  }
  return NextResponse.json({
    submissions: submissions.map((submission) => {
      const profile = byId.get(submission.student_id);
      const sender = submission.submitted_by ? byId.get(submission.submitted_by) : null;
      return {
        ...submission,
        ...(profile ? { student: { ...profile, role: 'student' } } : {}),
        ...(sender ? { submitted_by_name: `${sender.first_name || ''} ${sender.last_name || ''}`.trim() } : {}),
      };
    }),
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const {
      assignment_id,
      student_name,
      student_first_name,
      student_last_name,
      student_avatar,
      answers: rawAnswers = [],
      antiCheating = {},
      proxy_student_number,
    } = body;
    // A survey's answers are normalised below.
    let answers = rawAnswers;

    // The student is whoever LINE says the token belongs to, never an id from the body.
    const actor = await getActor(request);
    if (actor?.kind !== 'student') {
      return NextResponse.json({ error: 'กรุณาเข้าสู่ระบบผ่าน LINE ก่อนส่งงาน' }, { status: 401 });
    }
    const line_uid = actor.lineUid;
    const student_id = actor.userId;

    console.log('[POST /api/submissions] Received payload:', {
      assignment_id,
      student_id,
      line_uid,
      student_name: student_name || `${student_first_name} ${student_last_name}`,
      answers_count: answers?.length,
    });

    if (!assignment_id || (!student_id && !line_uid)) {
      console.warn('[POST /api/submissions] Missing required fields');
      return NextResponse.json(
        { error: 'assignment_id and student identification are required' },
        { status: 400 }
      );
    }

    let supabase: ReturnType<typeof createServiceSupabaseClient>;
    try {
      supabase = createServiceSupabaseClient();
    } catch (configErr) {
      console.error('[POST /api/submissions] Supabase is not configured:', configErr);
      return NextResponse.json({ error: 'ระบบฐานข้อมูลยังไม่พร้อมใช้งาน กรุณาติดต่อคุณครู' }, { status: 503 });
    }

    // The assignment must exist and still accept work. The deadline rules are
    // shared with the teacher portal so both sides agree on open/closed/late.
    const { data: assignment, error: assignmentError } = await supabase
      .from('assignments')
      // `*` so databases without publish_at yet still work.
      .select('*')
      .eq('id', assignment_id)
      .maybeSingle();
    if (assignmentError) {
      console.error('[POST /api/submissions] Assignment lookup failed:', assignmentError);
      return NextResponse.json({ error: 'ไม่สามารถตรวจสอบงานนี้ได้ กรุณาลองใหม่อีกครั้ง' }, { status: 503 });
    }
    if (!assignment) {
      return NextResponse.json({ error: 'ไม่พบงานหรือข้อสอบนี้ในระบบ อาจถูกลบไปแล้ว' }, { status: 404 });
    }
    const assignmentWindow = getAssignmentWindow(assignment, Date.now(), QUIZ_LATE_GRACE_MS);
    // Only admitted students of the assignment's classroom may submit.
    const classroom = await loadClassroom(supabase, assignment.classroom_id);
    if (!classroom || (await classroomRole(supabase, actor, classroom as Classroom)) !== 'student') {
      return NextResponse.json({ error: 'คุณยังไม่ได้อยู่ในห้องเรียนนี้ หรือยังรอคุณครูอนุมัติ' }, { status: 403 });
    }
    // Borrowed phone: the work belongs to the classmate, the phone's owner is recorded as the sender.
    let proxyStudent: ProxyStudent | null = null;
    if (proxy_student_number) {
      try {
        proxyStudent = await resolveProxyStudent(supabase, actor, classroom as Classroom, proxy_student_number);
      } catch (proxyError) {
        if (proxyError instanceof HttpError) return NextResponse.json({ error: proxyError.message }, { status: proxyError.status });
        throw proxyError;
      }
    }
    // A retake quiz takes only the students the teacher chose (whoever's phone sends it).
    const owner = proxyStudent ? [proxyStudent.id, proxyStudent.line_uid] : actor.keys;
    if (!retakeIncludes(assignment, owner)) {
      return NextResponse.json({ error: 'ข้อสอบนี้เป็นการสอบซ่อมสำหรับนักเรียนที่คุณครูเลือกเท่านั้น' }, { status: 403 });
    }
    if (assignmentWindow.isScheduled || assignmentWindow.isDraft) {
      return NextResponse.json({ error: 'งานนี้ยังไม่เปิดให้ส่ง' }, { status: 409 });
    }
    const closedError = assignmentWindow.isQuizClosed
      ? `หมดเวลาทำข้อสอบ “${assignment.title}” แล้ว ไม่สามารถส่งคำตอบได้`
      : assignmentWindow.isLateClosed
      ? `หมดเวลาส่งงาน “${assignment.title}” แล้ว (ปิดรับส่งงาน ${assignmentWindow.lateUntil ? formatDateTime(new Date(assignmentWindow.lateUntil).toISOString(), 'th', SCHOOL_TIME_ZONE) : ''}) — ติดต่อคุณครูหากต้องการขอขยายเวลา`
      : !assignmentWindow.acceptsSubmissions
      ? `คุณครูปิดรับ${assignment.is_exam ? 'ข้อสอบ' : 'งาน'} “${assignment.title}” แล้ว ไม่สามารถส่งได้`
      : null;

    // Leaving the screen is tracked during quizzes only; homework may be done
    // alongside other apps (looking up references, taking photos).
    const tracked = !!assignment.is_exam;
    // Replaced below by the trips saved live on the server merged with these (mergeAwayEvents).
    let awaySeconds = tracked ? Number(antiCheating.away_time_seconds || 0) : 0;
    let tabSwitchCount = tracked ? Number(antiCheating.tab_switch_count || 0) : 0;

    const firstName = proxyStudent?.first_name || student_first_name || (student_name ? student_name.split(' ')[0] : 'นักเรียน');
    const lastName = proxyStudent?.last_name || student_last_name || (student_name ? student_name.split(' ').slice(1).join(' ') : '');

    // Resolve the canonical users.id. LIFF sends the school student number as
    // student_id, but submissions.student_id is a foreign key to users.id and the
    // teacher roster matches on that id, so every copy must use it.
    let targetUserDbId = proxyStudent?.id || line_uid || student_id;
    let existingUser: { id: string } | null = proxyStudent ? { id: proxyStudent.id } : null;
    if (!existingUser && line_uid) {
      const { data } = await supabase.from('users').select('id').eq('line_uid', line_uid).maybeSingle();
      existingUser = data;
    }
    if (!existingUser && student_id) {
      const { data } = await supabase.from('users').select('id').eq('id', student_id).maybeSingle();
      existingUser = data;
    }
    if (existingUser?.id) targetUserDbId = existingUser.id;

    // Reuse the existing row id on resubmission. submissions has a UNIQUE
    // (assignment_id, student_id) constraint, so a new id for the same student
    // (e.g. after editing their student number) would make the upsert fail.
    // `*` so databases without reopened_at yet still work.
    // Quizzes: how often the student closed the quiz and opened it again (counted at each opening).
    const [{ data: existingSubmission }, quizAttempt] = await Promise.all([
      supabase
        .from('submissions')
        .select('*')
        .eq('assignment_id', assignment_id)
        .eq('student_id', targetUserDbId)
        .maybeSingle(),
      tracked
        ? readQuizAttempt(supabase, assignment_id, targetUserDbId).catch((attemptError): QuizAttempt | null => {
            console.warn('[POST /api/submissions] quiz attempt lookup failed:', attemptError);
            return null;
          })
        : Promise.resolve<QuizAttempt | null>(null),
    ]);
    const quizExits = quizAttempt?.exits || 0;
    // Trips away: saved live during the quiz (they survive closing LINE) plus the phone's own report.
    const awayMerged = tracked
      ? mergeAwayEvents(quizAttempt?.awayEvents || [], (antiCheating.events || []) as IncomingEvent[], quizAttempt?.openedAt || [], new Date())
      : null;
    if (awayMerged) {
      tabSwitchCount = Math.max(tabSwitchCount, awayMerged.count);
      awaySeconds = Math.max(awaySeconds, awayMerged.seconds);
    }
    const { data: previousAnswers } = existingSubmission
      ? await supabase.from('submission_answers').select('file_url, graded_at').eq('submission_id', existingSubmission.id)
      : { data: [] as Array<{ file_url: string | null; graded_at: string | null }> };
    // Handing in again replaces the answers and the teacher's scores. A quiz is
    // never retaken; handed-in homework is view-only until the teacher reopens
    // it for this student (canEditSubmission), even before the deadline.
    // The same per-student permission lets a student the teacher recorded as
    // "no submission" (a 'pending' row) hand in after the work closed, quizzes
    // too. It may carry a time limit (reopen_until).
    const isEdit = !!existingSubmission && isHandedIn(existingSubmission);
    const reopened = !!existingSubmission && isReopenActive(existingSubmission, Date.now(), REOPEN_GRACE_MS);
    const reopenExpired = !!existingSubmission?.reopened_at && !reopened;
    if (isEdit && assignment.is_exam) {
      return NextResponse.json({ error: 'ส่งข้อสอบนี้ไปแล้ว ไม่สามารถส่งซ้ำได้' }, { status: 409 });
    }
    if (closedError && !reopened) {
      const error = reopenExpired
        ? `เวลาที่คุณครูเปิดให้ส่ง “${assignment.title}” หมดแล้ว — ติดต่อคุณครูหากต้องการเวลาเพิ่ม`
        : isEdit
        ? `ปิดรับงาน “${assignment.title}” แล้ว จึงแก้ไขงานที่ส่งไม่ได้ — ติดต่อคุณครูหากต้องการแก้ไข`
        : closedError;
      return NextResponse.json({ error }, { status: 409 });
    }
    // งานกลุ่ม: handed in for the student's group, so they must be in one first.
    const groupWork = isGroupWork(assignment);
    const group = groupWork
      ? await groupOfStudent(supabase, assignment_id, [targetUserDbId, ...(proxyStudent ? [proxyStudent.line_uid || ''] : actor.keys)]).catch((groupErr) => {
          console.error('[POST /api/submissions] group lookup failed:', groupErr);
          return null;
        })
      : null;
    if (groupWork && !group) {
      return NextResponse.json({
        error: proxyStudent
          ? `งานกลุ่ม: เลือกกลุ่มให้ ${firstName} ก่อนส่งงาน`
          : 'งานกลุ่ม: เลือกกลุ่มก่อนส่งงาน',
      }, { status: 409 });
    }
    // A กิจกรรม can be answered again while it is open (closedError covers a closed one).
    if (isEdit && !reopened && !isSurvey(assignment)) {
      if (groupWork) {
        return NextResponse.json({ error: 'กลุ่มของคุณส่งงานนี้แล้ว (ส่งให้ทุกคนในกลุ่ม) — ติดต่อคุณครูหากต้องการแก้ไข' }, { status: 409 });
      }
      return NextResponse.json({
        error: reopenExpired
          ? 'เวลาที่คุณครูเปิดให้แก้ไขงานนี้หมดแล้ว — ติดต่อคุณครูหากต้องการเวลาเพิ่ม'
          : 'ส่งงานนี้แล้ว จึงแก้ไขหรือส่งซ้ำไม่ได้ — ติดต่อคุณครูให้กด "ให้แก้ไขงาน" ก่อน',
      }, { status: 409 });
    }

    if (!existingUser?.id) {
      // LIFF syncs the profile on login, so this only runs for legacy clients.
      const { error: userError } = await supabase.from('users').insert({
        id: targetUserDbId,
        role: 'student',
        first_name: firstName,
        last_name: lastName,
        student_id: student_id || undefined,
        line_uid: line_uid || undefined,
        avatar_url: student_avatar || undefined,
      });
      if (userError) {
        console.error('[POST /api/submissions] Student user insert failed:', userError);
        return NextResponse.json({ error: 'ไม่พบบัญชีนักเรียนในระบบ กรุณาออกจากระบบแล้วเข้าใหม่' }, { status: 409 });
      }
    }

    const subId = existingSubmission?.id || `sub-${assignment_id}-${targetUserDbId}`;

    const studentInfo = proxyStudent
      ? {
          id: proxyStudent.id,
          first_name: firstName,
          last_name: lastName,
          student_id: proxyStudent.student_id || '',
          line_uid: proxyStudent.line_uid || '',
          avatar_url: proxyStudent.avatar_url || '',
        }
      : {
          id: targetUserDbId,
          first_name: firstName,
          last_name: lastName,
          student_id: student_id || '',
          line_uid: line_uid || '',
          avatar_url: student_avatar || '',
        };

    // Calculate score for objective questions and determine total score
    let calculatedTotalScore: number | undefined = undefined;
    let assignmentMaxScore = 20;
    const scoredAnswers: Array<{ question_id: string; answer_text: string; file_url: string | null; teacher_score?: number }> = [];

    const { data: questions } = await supabase
      .from('questions')
      .select('*')
      .eq('assignment_id', assignment_id);

    const qsList = (questions || []) as Question[];
    const survey = isSurvey(assignment);
    // Survey answers in their stored form: checkbox picks as a JSON list of real
    // options, a scale as 1–5; anything else becomes blank.
    if (survey) {
      answers = ((answers as IncomingAnswer[]) || []).map((a) => {
        const q = qsList.find((item) => item.id === a.question_id);
        if (!q) return a;
        const text = String(a.answer_text || '').trim();
        const options = (q.options || []).map(String);
        const clean =
          q.type === 'checkboxes' ? encodeChecks(decodeChecks(text).filter((p) => options.includes(p)))
          : q.type === 'scale' ? (scaleValue(text) ? String(scaleValue(text)) : '')
          : q.type === 'multiple_choice' ? (options.includes(text) ? text : '')
          : text;
        // File questions keep their file; every other survey answer is text only.
        return { ...a, answer_text: clean, file_url: q.type === 'file_upload' ? a.file_url : null };
      });
    }
    // Left the quiz more often than warned about: whatever arrives, a blank sheet is handed in (0 points).
    const forfeited = tracked && quizOpenAction(quizExits, qsList.length) === 'forfeit';

    // A sheet with nothing on it is never saved: it would lock a quiz (or
    // homework) with 0 points, e.g. after a stray tap on the hand-in button.
    if (qsList.length > 0 && !forfeited) {
      const ownAnswers = ((answers as IncomingAnswer[]) || []).filter((a) => qsList.some((q) => q.id === a.question_id));
      const usable = ownAnswers.map((a) => ({
        answer_text: a.answer_text,
        file_url: assignment.is_exam ? null : normalizeLink(a.file_url),
      }));
      if (!hasAnyAnswer(usable)) {
        return NextResponse.json(
          { error: 'ยังไม่ได้ตอบคำถามเลยสักข้อ จึงยังไม่ได้ส่ง — ตอบอย่างน้อย 1 ข้อแล้วกดส่งอีกครั้ง' },
          { status: 400 }
        );
      }
    }

    // Homework: required questions must be answered (quizzes may be handed in unfinished).
    if (!assignment.is_exam) {
      const missingRequired = qsList.filter((q) => {
        if (q.is_required === false) return false;
        const ans = (answers as IncomingAnswer[] || []).find((a) => a.question_id === q.id);
        return !String(ans?.answer_text || '').trim() && !normalizeLink(ans?.file_url);
      });
      if (missingRequired.length) {
        return NextResponse.json(
          { error: `ยังไม่ได้ตอบคำถามที่จำเป็น ${missingRequired.length} ข้อ กรุณาตอบให้ครบก่อนส่ง` },
          { status: 400 }
        );
      }
    }
    if (qsList.length > 0) {
      let totalMax = 0;
      let runningScore = 0;
      let allGraded = true;

      for (const q of qsList) {
        totalMax += Number(q.max_score || 0);
        const studentAns = (answers as IncomingAnswer[] || []).find((a) => a.question_id === q.id);
        const studentText = forfeited ? '' : (studentAns?.answer_text || '').trim();

        let questionScore: number | undefined = undefined;

        if (survey) {
          // Survey answers are not scored (the response is complete as handed in).
        } else if (forfeited) {
          // The blank sheet is fully scored: nothing left for the teacher to grade.
          questionScore = 0;
        } else if (isObjectiveQuestion(q)) {
          // Choice and true/false answers are scored from the answer key right away.
          questionScore = scoreObjectiveAnswer(q, studentText);
          runningScore += questionScore;
        } else {
          // Written / file answers wait for the teacher.
          allGraded = false;
        }

        scoredAnswers.push({
          question_id: q.id,
          answer_text: studentText,
          // An uploaded file or a pasted http(s) link; anything else is dropped.
          // Quizzes take no files or photos.
          file_url: assignment.is_exam ? null : normalizeLink(studentAns?.file_url) || null,
          teacher_score: questionScore,
        });
      }

      if (totalMax > 0) assignmentMaxScore = totalMax;
      // The total is only given once every question has a score: with written or
      // file answers still to grade, students see their choice scores but no total yet.
      if (allGraded) calculatedTotalScore = Math.round(runningScore * 10) / 10;
    }
    // A survey response is complete as it is: 0 of 0, so it never waits for grading.
    if (survey) {
      calculatedTotalScore = 0;
      assignmentMaxScore = 0;
    }

    // Closing the quiz and coming back is always suspicious, even within the warnings.
    // A paste during a quiz (an answer brought in from elsewhere) is suspicious on its own too,
    // and so is selecting or copying a question's text (to look it up in another app). The
    // student is never warned about the copy rule; only the teacher sees why.
    const isSuspicious =
      tracked &&
      (quizExits > 0 || isSuspiciousActivity(tabSwitchCount, awaySeconds) || (awayMerged?.pastes || 0) > 0 || (awayMerged?.copies || 0) > 0);
    const submittedAt = new Date();
    const submissionRecord = {
      id: subId,
      assignment_id,
      student_id: targetUserDbId,
      student: studentInfo,
      // Quiz sheets that arrive in the hidden grace after the bell are late too (only teachers see it).
      // Within the (possibly extended) deadline it is on time. Past it, work the
      // teacher reopened keeps its original on-time / late mark, so fixing a
      // wrong file after the deadline never turns on-time work late.
      // Work recorded as missing and handed in now (the teacher allowed it) is late.
      status: !assignmentWindow.isPastDeadline ? 'submitted' : reopened && isEdit ? existingSubmission.status : 'late',
      started_at: new Date(submittedAt.getTime() - (awaySeconds * 1000 + 120000)).toISOString(),
      submitted_at: submittedAt.toISOString(),
      time_spent_seconds: 120 + awaySeconds,
      tab_switch_count: tabSwitchCount,
      total_time_away_seconds: awaySeconds,
      is_flagged_suspicious: isSuspicious,
      quiz_exit_count: quizExits,
      auto_forfeited: forfeited,
      total_score: calculatedTotalScore,
      max_total_score: assignmentMaxScore,
      answers: scoredAnswers,
      submitted_by: proxyStudent ? student_id : null,
    };

    try {
      const submissionRow: Record<string, unknown> = {
        id: submissionRecord.id,
        assignment_id: submissionRecord.assignment_id,
        student_id: targetUserDbId,
        status: submissionRecord.status,
        started_at: submissionRecord.started_at,
        submitted_at: submissionRecord.submitted_at,
        time_spent_seconds: submissionRecord.time_spent_seconds,
        tab_switch_count: submissionRecord.tab_switch_count,
        total_time_away_seconds: submissionRecord.total_time_away_seconds,
        is_flagged_suspicious: submissionRecord.is_flagged_suspicious,
        total_score: calculatedTotalScore !== undefined ? calculatedTotalScore : null,
        max_total_score: assignmentMaxScore,
        // Only written once the student has left a quiz: the columns exist wherever quiz_attempts does.
        ...(quizExits > 0 ? { quiz_exit_count: quizExits, auto_forfeited: forfeited } : {}),
        // Only borrowed-phone work names a sender, so databases without the column are unaffected otherwise.
        ...(submissionRecord.submitted_by ? { submitted_by: submissionRecord.submitted_by } : {}),
        // Handing in ends a reopen (only touched where the columns exist).
        ...(existingSubmission && 'reopened_at' in existingSubmission ? { reopened_at: null } : {}),
        ...(existingSubmission && 'reopen_until' in existingSubmission ? { reopen_until: null } : {}),
      };
      let { error: subErr } = await supabase.from('submissions').upsert(submissionRow);
      // Databases without submissions.submitted_by yet still save the work.
      if (subErr?.message?.includes('submitted_by')) {
        console.warn('[POST /api/submissions] submissions.submitted_by is missing; run supabase_proxy_submission_update.sql');
        const { submitted_by: _unused, ...withoutSender } = submissionRow;
        ({ error: subErr } = await supabase.from('submissions').upsert(withoutSender));
      }
      if (subErr) throw subErr;
      console.log('[POST /api/submissions] Supabase submissions upsert succeeded:', subId);

      // Replacing a row the teacher recorded as not handed in (e.g. a zero), or
      // edited homework: the new work is graded afresh, without earlier scores or comments.
      if (existingSubmission) {
        const { error: clearError } = await supabase.from('submission_answers').delete().eq('submission_id', subId);
        if (clearError) throw clearError;
      }

      // Save every answer in one request. Only answers to this assignment's
      // questions are kept; anything else would break the question foreign key.
      if (scoredAnswers.length > 0) {
        const { error: answerError } = await supabase.from('submission_answers').upsert(
          scoredAnswers.map((ans) => ({
            id: `ans-${subId}-${ans.question_id}`,
            submission_id: subId,
            question_id: ans.question_id,
            text_answer: ans.answer_text || '',
            file_url: ans.file_url || null,
            teacher_score: ans.teacher_score !== undefined ? ans.teacher_score : null,
          })),
          { onConflict: 'submission_id,question_id' }
        );
        if (answerError) throw answerError;
      }

      const events = awayMerged?.events || [];
      if (events.length > 0) {
        // One row per trip (stable ids, so handing in again does not repeat them).
        const { error: eventsError } = await supabase.from('submission_events').upsert(
          events.map((evt) => ({
            id: `evt-${subId}-away-${evt.id}`,
            submission_id: subId,
            event_type: evt.event_type,
            away_duration_seconds: evt.duration_seconds || 0,
            created_at: evt.started_at,
            details: evt.details || null,
          }))
        );
        // Audit events are supplementary; the submission itself is already saved.
        if (eventsError) console.warn('[POST /api/submissions] Event log write warning:', eventsError);
      }
      // Each reopening of the quiz (the first opening is the start, not an exit).
      const reopenedAt = quizAttempt?.openedAt.slice(1) || [];
      if (reopenedAt.length > 0) {
        const { error: reopenError } = await supabase.from('submission_events').insert(
          reopenedAt.map((at, i) => ({
            id: `evt-${subId}-reopen-${i + 1}`,
            submission_id: subId,
            event_type: 'quiz_reopened',
            away_duration_seconds: 0,
            created_at: at,
            details:
              forfeited && i === reopenedAt.length - 1
                ? `ปิดข้อสอบแล้วเปิดใหม่ ครั้งที่ ${i + 1} — เกินจำนวนที่เตือนไว้ ระบบส่งกระดาษเปล่าอัตโนมัติ (0 คะแนน)`
                : `ปิดข้อสอบแล้วเปิดใหม่ ครั้งที่ ${i + 1} (เตือนแล้ว)`,
          }))
        );
        if (reopenError) console.warn('[POST /api/submissions] Reopen event write warning:', reopenError);
      }
      console.log('[POST /api/submissions] Supabase answer write completed:', subId);
    } catch (dbErr) {
      console.error('[POST /api/submissions] Supabase service write error:', dbErr);
      return NextResponse.json({
        error: 'บันทึกคำตอบลงฐานข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
        detail: dbErr instanceof Error ? dbErr.message : (dbErr as { message?: string } | null)?.message || 'Supabase write failed',
      }, { status: 503 });
    }

    // A retake's score replaces the original quiz's score (before replying, so the grade book is right at once).
    if (isRetake(assignment)) {
      try {
        await syncRetakeScores(supabase, assignment, [subId]);
      } catch (syncError) {
        console.error('[POST /api/submissions] Retake score sync failed:', syncError);
      }
    }

    // งานกลุ่ม: the same work counts for every member (before replying, so the teacher sees the whole group).
    if (group) {
      try {
        await syncGroupCopies(supabase, assignment_id, subId, 'handin', group);
      } catch (groupError) {
        console.error('[POST /api/submissions] Group copy failed:', groupError);
      }
    }

    // The handed-in files are now in use (before replying, so leaving the page cannot drop them);
    // this phone's other uploads for the same student (own work, or this classmate's) were replaced or abandoned.
    const fileUrls = scoredAnswers.map((ans) => ans.file_url);
    await attachFiles(supabase, fileUrls, assignment_id, actor.keys);
    // Edited homework: files from the earlier version that are no longer used go too.
    const droppedKeys = keysFromUrls((previousAnswers || []).map((ans) => ans.file_url).filter((url) => !fileUrls.includes(url)));
    if (droppedKeys.length) after(() => removeFiles(supabase, droppedKeys));
    after(() => discardDrafts(supabase, assignment_id, actor.keys, fileUrls, proxyStudent ? onBehalfTag(proxy_student_number) : ''));
    // Teacher pages with this classroom open refresh their counts now instead of polling.
    after(() => signalClassroom(assignment.classroom_id, { type: 'submission', assignmentId: assignment_id, ...(group ? {} : { studentIds: [targetUserDbId] }) }));
    // Choice / true-false results are only shown once nobody can hand in any
    // more (this hand-in may have been the last one). Read after the write.
    const release = await resultRelease(supabase, [assignment], [{ assignment_id, status: submissionRecord.status as Submission['status'], total_score: calculatedTotalScore ?? null }]);
    if (release.hidden.size > 0) {
      return NextResponse.json({
        success: true,
        submission: {
          ...maskSubmission(submissionRecord as unknown as Submission),
          answers: scoredAnswers.map((ans) => (release.hiddenQuestionIds.has(ans.question_id) ? { ...ans, teacher_score: undefined } : ans)),
        },
      });
    }
    return NextResponse.json({ success: true, submission: submissionRecord });
  } catch (error) {
    console.error('[POST /api/submissions] Fatal error:', error);
    return NextResponse.json({ error: (error as { message?: string } | null)?.message || 'Internal Server Error' }, { status: 500 });
  }
}
