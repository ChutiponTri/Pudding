import { after, NextRequest, NextResponse } from 'next/server';
import { signalClassroom } from '@/lib/realtime/classroomSignal';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { getAssignmentWindow, LATE_WINDOW_HOURS, QUIZ_LATE_GRACE_MS } from '@/lib/utils/assignmentWindow';
import { isObjectiveQuestion, scoreObjectiveAnswer } from '@/lib/utils/autoGrade';
import { isSuspiciousActivity } from '@/lib/utils/integrity';
import { getActor } from '@/lib/auth/actor';
import { classroomRole, HttpError, isTeacherOf, loadClassroom } from '@/lib/server/access';
import { resolveProxyStudent, type ProxyStudent } from '@/lib/server/proxyStudent';
import { attachFiles, discardDrafts } from '@/lib/storage/files';
import { normalizeLink, onBehalfTag } from '@/lib/storage/uploadRules';
import type { Classroom, Question } from '@/types/database';

/** What the student's browser sends; the body is untrusted, so only these fields are read. */
type IncomingAnswer = { question_id: string; answer_text?: string; file_url?: string };
type IncomingEvent = { event_type: string; timestamp?: string; duration_seconds?: number; details?: string };
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
  const submissions = (data || []) as SubmissionRow[];
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
      answers = [],
      antiCheating = {},
      proxy_student_number,
    } = body;

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
    if (assignmentWindow.isScheduled || assignmentWindow.isDraft) {
      return NextResponse.json({ error: 'งานนี้ยังไม่เปิดให้ส่ง' }, { status: 409 });
    }
    if (assignmentWindow.isQuizClosed) {
      return NextResponse.json({ error: `หมดเวลาทำข้อสอบ “${assignment.title}” แล้ว ไม่สามารถส่งคำตอบได้` }, { status: 409 });
    }
    if (assignmentWindow.isLateClosed) {
      return NextResponse.json({ error: `หมดเวลาส่งงาน “${assignment.title}” แล้ว (รับงานส่งช้าได้ถึง ${LATE_WINDOW_HOURS} ชม. หลังกำหนดส่ง) — ติดต่อคุณครูหากต้องการขอขยายเวลา` }, { status: 409 });
    }
    if (!assignmentWindow.acceptsSubmissions) {
      return NextResponse.json({ error: `คุณครูปิดรับ${assignment.is_exam ? 'ข้อสอบ' : 'งาน'} “${assignment.title}” แล้ว ไม่สามารถส่งได้` }, { status: 409 });
    }

    // Leaving the screen is tracked during quizzes only; homework may be done
    // alongside other apps (looking up references, taking photos).
    const tracked = !!assignment.is_exam;
    const awaySeconds = tracked ? Number(antiCheating.away_time_seconds || 0) : 0;
    const tabSwitchCount = tracked ? Number(antiCheating.tab_switch_count || 0) : 0;
    const isSuspicious = tracked && isSuspiciousActivity(tabSwitchCount, awaySeconds);

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
    if (existingUser?.id) {
      targetUserDbId = existingUser.id;
    } else {
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

    // Reuse the existing row id on resubmission. submissions has a UNIQUE
    // (assignment_id, student_id) constraint, so a new id for the same student
    // (e.g. after editing their student number) would make the upsert fail.
    const { data: existingSubmission } = await supabase
      .from('submissions')
      .select('id, status')
      .eq('assignment_id', assignment_id)
      .eq('student_id', targetUserDbId)
      .maybeSingle();
    // Handing in again would overwrite the answers and erase the teacher's
    // scores, and would let a quiz be retaken; only an unfinished draft may be replaced.
    if (existingSubmission && existingSubmission.status !== 'pending') {
      return NextResponse.json(
        { error: assignment.is_exam ? 'ส่งข้อสอบนี้ไปแล้ว ไม่สามารถส่งซ้ำได้' : 'ส่งงานนี้ไปแล้ว ไม่สามารถส่งซ้ำได้' },
        { status: 409 }
      );
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
        const studentText = (studentAns?.answer_text || '').trim();

        let questionScore: number | undefined = undefined;

        if (isObjectiveQuestion(q)) {
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

    const submittedAt = new Date();
    const submissionRecord = {
      id: subId,
      assignment_id,
      student_id: targetUserDbId,
      student: studentInfo,
      // A quiz answer that arrives within the grace period counts as on time.
      // Quiz sheets that arrive in the hidden grace after the bell are late too (only teachers see it).
      status: assignmentWindow.isPastDeadline ? 'late' : 'submitted',
      started_at: new Date(submittedAt.getTime() - (awaySeconds * 1000 + 120000)).toISOString(),
      submitted_at: submittedAt.toISOString(),
      time_spent_seconds: 120 + awaySeconds,
      tab_switch_count: tabSwitchCount,
      total_time_away_seconds: awaySeconds,
      is_flagged_suspicious: isSuspicious,
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
        // Only borrowed-phone work names a sender, so databases without the column are unaffected otherwise.
        ...(submissionRecord.submitted_by ? { submitted_by: submissionRecord.submitted_by } : {}),
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

      // Replacing a row the teacher recorded as not handed in (e.g. a zero):
      // the real work is graded afresh, without that earlier score.
      if (existingSubmission?.status === 'pending') {
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

      const events = tracked ? antiCheating.events || [] : [];
      if (events.length > 0) {
        const { error: eventsError } = await supabase.from('submission_events').insert(
          events.map((evt: IncomingEvent, i: number) => ({
            id: `evt-${subId}-${Date.now()}-${i}`,
            submission_id: subId,
            event_type: evt.event_type,
            away_duration_seconds: evt.duration_seconds || 0,
            created_at: evt.timestamp || new Date().toISOString(),
            details: evt.details || null,
          }))
        );
        // Audit events are supplementary; the submission itself is already saved.
        if (eventsError) console.warn('[POST /api/submissions] Event log write warning:', eventsError);
      }
      console.log('[POST /api/submissions] Supabase answer write completed:', subId);
    } catch (dbErr) {
      console.error('[POST /api/submissions] Supabase service write error:', dbErr);
      return NextResponse.json({
        error: 'บันทึกคำตอบลงฐานข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
        detail: dbErr instanceof Error ? dbErr.message : (dbErr as { message?: string } | null)?.message || 'Supabase write failed',
      }, { status: 503 });
    }

    // The handed-in files are now in use (before replying, so leaving the page cannot drop them);
    // this phone's other uploads for the same student (own work, or this classmate's) were replaced or abandoned.
    const fileUrls = scoredAnswers.map((ans) => ans.file_url);
    await attachFiles(supabase, fileUrls, assignment_id, actor.keys);
    after(() => discardDrafts(supabase, assignment_id, actor.keys, fileUrls, proxyStudent ? onBehalfTag(proxy_student_number) : ''));
    // Teacher pages with this classroom open refresh their counts now instead of polling.
    after(() => signalClassroom(assignment.classroom_id, { type: 'submission', assignmentId: assignment_id }));
    return NextResponse.json({ success: true, submission: submissionRecord });
  } catch (error) {
    console.error('[POST /api/submissions] Fatal error:', error);
    return NextResponse.json({ error: (error as { message?: string } | null)?.message || 'Internal Server Error' }, { status: 500 });
  }
}
