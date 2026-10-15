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

    if (!assignment_id || (!student_id && !line_uid)) {
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
      total_score: undefined,
    };

    // 1. Save to File Fallback Store (Guarantees local persistence and immediate availability)
    fallbackStore.saveSubmission(submissionRecord);

    // 2. Try Supabase Service Role (bypasses RLS)
    try {
      const supabase = createServiceSupabaseClient();
      await supabase.from('submissions').upsert({
        id: submissionRecord.id,
        assignment_id: submissionRecord.assignment_id,
        student_id: submissionRecord.student_id,
        status: submissionRecord.status,
        started_at: submissionRecord.started_at,
        submitted_at: submissionRecord.submitted_at,
        time_spent_seconds: submissionRecord.time_spent_seconds,
        tab_switch_count: submissionRecord.tab_switch_count,
        total_time_away_seconds: submissionRecord.total_time_away_seconds,
        is_flagged_suspicious: submissionRecord.is_flagged_suspicious,
      });

      for (const ans of answers) {
        if (ans.question_id) {
          await supabase.from('submission_answers').upsert({
            id: `ans-${subId}-${ans.question_id}`,
            submission_id: subId,
            question_id: ans.question_id,
            text_answer: ans.answer_text || '',
            file_url: ans.file_url || null,
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
      console.warn('POST /api/submissions Supabase service write notice:', dbErr);
    }

    return NextResponse.json({ success: true, submission: submissionRecord });
  } catch (error: any) {
    console.error('POST /api/submissions error:', error);
    return NextResponse.json({ error: error?.message || 'Internal Server Error' }, { status: 500 });
  }
}
