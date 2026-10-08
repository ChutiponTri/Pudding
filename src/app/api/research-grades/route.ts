import { NextRequest, NextResponse } from 'next/server';
import { createClient, isSupabaseConfigured } from '@/lib/supabase/client';
import { TeacherGradeRecord } from '@/types/database';

export const runtime = 'nodejs';

/**
 * Dedicated API for Research Evaluator (ครูตรวจงานวิจัย / IRR)
 * 
 * Guarantees:
 * 1. Saves solely to `submission_answers.research_grades[teacher_id]`
 * 2. Never modifies official scores (`teacher_score`, `teacher_comment`)
 * 3. Never alters student-facing totals in `submissions`
 * 4. Never exposes research data to student LIFF views
 */

// GET: Retrieve research grades for a given submission or question
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const submissionId = searchParams.get('submissionId');
    const questionId = searchParams.get('questionId');
    const teacherId = searchParams.get('teacherId');

    if (!submissionId) {
      return NextResponse.json(
        { error: 'Missing required parameter: submissionId' },
        { status: 400 }
      );
    }

    if (!isSupabaseConfigured) {
      return NextResponse.json({
        success: true,
        source: 'preview_mock',
        message: 'Supabase credentials not configured in environment. Using in-memory/client cache.',
        research_grades: {},
      });
    }

    const supabase = createClient();
    let query = supabase
      .from('submission_answers')
      .select('id, submission_id, question_id, research_grades')
      .eq('submission_id', submissionId);

    if (questionId) {
      query = query.eq('question_id', questionId);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Filter by specific teacherId if requested
    const result = data?.map((row) => {
      const allResearch = (row.research_grades || {}) as Record<string, TeacherGradeRecord>;
      if (teacherId) {
        return {
          id: row.id,
          submission_id: row.submission_id,
          question_id: row.question_id,
          grade: allResearch[teacherId] || null,
        };
      }
      return {
        id: row.id,
        submission_id: row.submission_id,
        question_id: row.question_id,
        research_grades: allResearch,
      };
    });

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (err) {
    console.error('Error in GET /api/research-grades:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST: Save research grade for a specific question answer
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      submissionId,
      questionId,
      score,
      comment,
      teacherId,
      teacherName,
    } = body;

    if (!submissionId || !questionId || !teacherId) {
      return NextResponse.json(
        {
          error: 'Missing required fields: submissionId, questionId, and teacherId are required',
        },
        { status: 400 }
      );
    }

    const numScore = Number(score);
    if (isNaN(numScore) || numScore < 0) {
      return NextResponse.json(
        { error: 'Invalid score: score must be a non-negative number' },
        { status: 400 }
      );
    }

    const researchRecord: TeacherGradeRecord = {
      teacher_id: teacherId,
      teacher_name: teacherName || 'ครูตรวจวิจัย (Research Evaluator)',
      teacher_role: 'researcher',
      score: numScore,
      comment: typeof comment === 'string' ? comment.trim() : '',
      graded_at: new Date().toISOString(),
    };

    if (!isSupabaseConfigured) {
      return NextResponse.json({
        success: true,
        source: 'preview_mock',
        message: 'Research grade saved successfully in preview mode',
        grade_record: researchRecord,
      });
    }

    const supabase = createClient();

    // 1. Fetch current answer row to preserve existing fields and other researchers' grades
    const { data: existingAnswer, error: fetchErr } = await supabase
      .from('submission_answers')
      .select('id, research_grades')
      .eq('submission_id', submissionId)
      .eq('question_id', questionId)
      .maybeSingle();

    if (fetchErr) {
      return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    }

    const currentMap = (existingAnswer?.research_grades || {}) as Record<string, TeacherGradeRecord>;
    const updatedMap = {
      ...currentMap,
      [teacherId]: researchRecord,
    };

    // 2. Upsert ONLY research_grades — DO NOT touch teacher_score or student-facing total_score
    const answerId = existingAnswer?.id || `ans-${submissionId}-${questionId}`;
    const { error: upsertErr } = await supabase
      .from('submission_answers')
      .upsert({
        id: answerId,
        submission_id: submissionId,
        question_id: questionId,
        research_grades: updatedMap,
      });

    if (upsertErr) {
      return NextResponse.json({ error: upsertErr.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: 'Research grade saved successfully without affecting official student scores',
      data: {
        submission_id: submissionId,
        question_id: questionId,
        teacher_id: teacherId,
        grade_record: researchRecord,
      },
    });
  } catch (err) {
    console.error('Error in POST /api/research-grades:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
