import { NextRequest, NextResponse } from 'next/server';
import { createServiceSupabaseClient, createAnonServerSupabaseClient } from '@/lib/supabase/server';
import { fallbackStore } from '@/lib/classroom/storageFallback';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const assignmentId = request.nextUrl.searchParams.get('assignmentId');
  if (!assignmentId) {
    return NextResponse.json({ submissions: fallbackStore.getSubmissions() });
  }

  let dbSubmissions: any[] = [];
  try {
    const supabase = createServiceSupabaseClient();
    const { data, error } = await supabase
      .from('submissions')
      .select('*')
      .eq('assignment_id', assignmentId);
    if (!error && data) {
      dbSubmissions = data;
    }
  } catch (err) {
    console.warn('GET /api/submissions supabase error:', err);
  }

  const localSubmissions = fallbackStore.getSubmissions(assignmentId);
  const seen = new Set<string>();
  const merged: any[] = [];

  for (const s of [...localSubmissions, ...dbSubmissions]) {
    if (!seen.has(s.id)) {
      seen.add(s.id);
      merged.push(s);
    }
  }

  return NextResponse.json({ submissions: merged });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const {
      assignment_id,
      student_id,
      student_name,
      student_first_name,
      student_last_name,
      student_avatar,
      line_uid,
      answers = [],
      antiCheating = {},
    } = body;

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

    const effectiveStudentId = student_id || line_uid;
    const subId = `sub-${assignment_id}-${effectiveStudentId}`;
    const awaySeconds = Number(antiCheating.away_time_seconds || 0);
    const tabSwitchCount = Number(antiCheating.tab_switch_count || 0);
    const isSuspicious = tabSwitchCount >= 3 || awaySeconds >= 30;

    const firstName = student_first_name || (student_name ? student_name.split(' ')[0] : 'นักเรียน');
    const lastName = student_last_name || (student_name ? student_name.split(' ').slice(1).join(' ') : '');

    const studentInfo = {
      id: effectiveStudentId,
      first_name: firstName,
      last_name: lastName,
      student_id: student_id || '',
      line_uid: line_uid || '',
      avatar_url: student_avatar || '',
    };

    // Calculate score for objective questions and determine total score
    let calculatedTotalScore: number | undefined = undefined;
    let assignmentMaxScore = 20;
    const scoredAnswers: any[] = [];

    try {
      const supabase = createServiceSupabaseClient();
      const { data: questions } = await supabase
        .from('questions')
        .select('*')
        .eq('assignment_id', assignment_id);

      const qsList: any[] = questions || [];
      if (qsList.length > 0) {
        let totalMax = 0;
        let runningScore = 0;
        let allGraded = true;

        for (const q of qsList) {
          totalMax += Number(q.max_score || 0);
          const studentAns = (answers || []).find((a: any) => a.question_id === q.id);
          const studentText = (studentAns?.answer_text || '').trim();

          let questionScore: number | undefined = undefined;
          let aiScore: number | undefined = undefined;

          if (q.type === 'multiple_choice' || q.type === 'true_false') {
            const ideal = (q.ideal_answer || '').trim();
            if (ideal && studentText) {
              const isMatch = studentText.toLowerCase() === ideal.toLowerCase() ||
                studentText.startsWith(ideal) || ideal.startsWith(studentText);
              questionScore = isMatch ? Number(q.max_score) : 0;
              runningScore += questionScore;
            } else {
              questionScore = 0;
            }
          } else {
            // Subjective / file upload question: provide initial evaluation score or mark as pending
            allGraded = false;
            aiScore = Math.max(1, Math.round(Number(q.max_score || 5) * 0.8));
          }

          scoredAnswers.push({
            question_id: q.id,
            answer_text: studentText,
            file_url: studentAns?.file_url || null,
            teacher_score: questionScore,
            ai_mock_score: aiScore,
          });
        }

        if (totalMax > 0) assignmentMaxScore = totalMax;
        if (allGraded) {
          calculatedTotalScore = runningScore;
        } else if (runningScore > 0) {
          calculatedTotalScore = runningScore;
        }
      }
    } catch (calcErr) {
      console.warn('[POST /api/submissions] Objective scoring check warning:', calcErr);
    }

    const submissionRecord = {
      id: subId,
      assignment_id,
      student_id: effectiveStudentId,
      student: studentInfo,
      status: 'submitted',
      started_at: new Date(Date.now() - (awaySeconds * 1000 + 120000)).toISOString(),
      submitted_at: new Date().toISOString(),
      time_spent_seconds: 120 + awaySeconds,
      tab_switch_count: tabSwitchCount,
      total_time_away_seconds: awaySeconds,
      is_flagged_suspicious: isSuspicious,
      total_score: calculatedTotalScore,
      max_total_score: assignmentMaxScore,
      answers: scoredAnswers.length > 0 ? scoredAnswers : answers,
    };

    // 1. Save to File Fallback Store (Guarantees local persistence and immediate availability)
    fallbackStore.saveSubmission(submissionRecord);
    console.log('[POST /api/submissions] Saved to local fallback store:', subId);

    // 2. Try Supabase Service Role (bypasses RLS)
    try {
      const supabase = createServiceSupabaseClient();

      // Check if user already exists by line_uid or id
      let targetUserDbId = effectiveStudentId;
      if (line_uid) {
        const { data: existingUser } = await supabase
          .from('users')
          .select('id')
          .eq('line_uid', line_uid)
          .maybeSingle();
        if (existingUser?.id) {
          targetUserDbId = existingUser.id;
        }
      }

      // Upsert user row so foreign key constraint users(id) succeeds
      await supabase.from('users').upsert(
        {
          id: targetUserDbId,
          role: 'student',
          first_name: firstName,
          last_name: lastName,
          student_id: student_id || undefined,
          line_uid: line_uid || undefined,
          avatar_url: student_avatar || undefined,
        },
        { onConflict: 'id', ignoreDuplicates: false }
      );

      // Ensure assignment row exists so foreign key constraint assignments(id) succeeds
      const { data: existingAssignment } = await supabase
        .from('assignments')
        .select('id')
        .eq('id', assignment_id)
        .maybeSingle();

      if (!existingAssignment) {
        console.log('[POST /api/submissions] Assignment not found in Supabase, inserting stub:', assignment_id);
        await supabase.from('assignments').insert({
          id: assignment_id,
          title: 'การบ้าน/ข้อสอบ',
          classroom_id: 'classroom',
          due_date: new Date(Date.now() + 7 * 86400000).toISOString(),
          total_points: assignmentMaxScore,
        });
      }

      // Upsert submission record
      const { error: subErr } = await supabase.from('submissions').upsert({
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
      });

      if (subErr) {
        console.error('[POST /api/submissions] Supabase submissions upsert error:', subErr);
      } else {
        console.log('[POST /api/submissions] Supabase submissions upsert succeeded:', subId);
      }

      // Upsert submission answers (and ensure question exists)
      const answersToSave = scoredAnswers.length > 0 ? scoredAnswers : answers;
      for (const ans of answersToSave) {
        if (ans.question_id) {
          const { data: existingQ } = await supabase
            .from('questions')
            .select('id')
            .eq('id', ans.question_id)
            .maybeSingle();

          if (!existingQ) {
            await supabase.from('questions').insert({
              id: ans.question_id,
              assignment_id,
              question_text: 'คำถามข้อนี้',
              type: 'essay',
              max_score: 5,
            });
          }

          await supabase.from('submission_answers').upsert({
            id: `ans-${subId}-${ans.question_id}`,
            submission_id: subId,
            question_id: ans.question_id,
            text_answer: ans.answer_text || '',
            file_url: ans.file_url || null,
            teacher_score: ans.teacher_score !== undefined ? ans.teacher_score : null,
          });
        }
      }

      const events = antiCheating.events || [];
      for (let i = 0; i < events.length; i++) {
        const evt = events[i];
        await supabase.from('submission_events').insert({
          id: `evt-${subId}-${Date.now()}-${i}`,
          submission_id: subId,
          event_type: evt.event_type,
          away_duration_seconds: evt.duration_seconds || 0,
          created_at: evt.timestamp || new Date().toISOString(),
          details: evt.details || null,
        });
      }
    } catch (dbErr) {
      console.error('[POST /api/submissions] Supabase service write error:', dbErr);
    }

    return NextResponse.json({ success: true, submission: submissionRecord });
  } catch (error: any) {
    console.error('[POST /api/submissions] Fatal error:', error);
    return NextResponse.json({ error: error?.message || 'Internal Server Error' }, { status: 500 });
  }
}

