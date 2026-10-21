import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RosterEntry = { id?: string; line_uid?: string; student_id?: string; first_name?: string; last_name?: string; institution?: string };
type ClassroomRow = { id: string; teacher_id?: string | null; teachers?: Array<{ teacher_id?: string }> | null; students?: RosterEntry[] | null; pending_students?: RosterEntry[] | null };

/**
 * Teacher corrects a student's name / surname / student number / school
 * (students sometimes mistype them when joining from LIFF).
 *
 * Only a teacher of `classroomId` may do this, and only for a student of that
 * classroom. The users row is the source of truth; the roster snapshots kept
 * on every classroom the student belongs to are patched to match.
 */
export async function PATCH(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const classroomId = typeof body.classroomId === 'string' ? body.classroomId : '';
  const studentKey = typeof body.studentId === 'string' ? body.studentId.trim() : '';
  const firstName = typeof body.firstName === 'string' ? body.firstName.trim() : '';
  const lastName = typeof body.lastName === 'string' ? body.lastName.trim() : '';
  const studentNumber = typeof body.studentNumber === 'string' ? body.studentNumber.trim() : '';
  // Omitted (older clients) leaves the school unchanged.
  const institution = typeof body.institution === 'string' ? body.institution.trim() : undefined;
  if (!classroomId || !studentKey) return NextResponse.json({ error: 'classroomId and studentId are required' }, { status: 400 });
  if (!firstName || !lastName) return NextResponse.json({ error: 'กรุณากรอกชื่อและนามสกุล' }, { status: 400 });

  const supabase = createServiceSupabaseClient();
  const { data: classroom } = await supabase
    .from('classrooms')
    .select('id, teacher_id, teachers, students, pending_students')
    .eq('id', classroomId)
    .maybeSingle<ClassroomRow>();
  const isTeacher =
    classroom?.teacher_id === userId || (classroom?.teachers || []).some((teacher) => teacher.teacher_id === userId);
  if (!classroom || !isTeacher) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Roster ids may be users.id or a LINE uid.
  const [byId, byLineUid] = await Promise.all([
    supabase.from('users').select('id, line_uid').eq('id', studentKey).maybeSingle(),
    supabase.from('users').select('id, line_uid').eq('line_uid', studentKey).limit(1).maybeSingle(),
  ]);
  const user = byId.data || byLineUid.data;
  const keys = [...new Set([studentKey, user?.id, user?.line_uid].filter(Boolean))] as string[];
  const isSameStudent = (entry: RosterEntry) =>
    !!entry && keys.some((key) => entry.id === key || entry.line_uid === key);

  const inSnapshot = [...(classroom.students || []), ...(classroom.pending_students || [])].some(isSameStudent);
  let enrolled = inSnapshot;
  if (!enrolled) {
    const { data: link } = await supabase
      .from('classroom_students')
      .select('student_id')
      .eq('classroom_id', classroomId)
      .in('student_id', keys)
      .limit(1)
      .maybeSingle();
    enrolled = !!link;
  }
  if (!enrolled) return NextResponse.json({ error: 'Student is not in this classroom' }, { status: 404 });

  const fields: Record<string, string | null> = { first_name: firstName, last_name: lastName, student_id: studentNumber || null };
  if (institution !== undefined) fields.institution = institution || null;
  if (user) {
    const { error } = await supabase.from('users').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', user.id);
    if (error) {
      console.error('Teacher student edit failed:', error);
      return NextResponse.json({ error: 'บันทึกข้อมูลผู้เรียนไม่สำเร็จ' }, { status: 500 });
    }
  }

  // Patch the roster snapshot on every classroom that lists this student.
  const containing = await Promise.all(
    keys.flatMap((key) =>
      (['students', 'pending_students'] as const).flatMap((column) =>
        (['id', 'line_uid'] as const).map((field) =>
          supabase.from('classrooms').select('id, students, pending_students').contains(column, JSON.stringify([{ [field]: key }]))
        )
      )
    )
  );
  const rows = new Map<string, ClassroomRow>();
  for (const { data } of containing) for (const row of (data || []) as ClassroomRow[]) rows.set(row.id, row);
  const patch = (entry: RosterEntry) =>
    isSameStudent(entry)
      ? { ...entry, ...fields, student_id: studentNumber || undefined, ...(institution !== undefined ? { institution: institution || undefined } : {}) }
      : entry;
  await Promise.all(
    [...rows.values()].map((row) =>
      supabase
        .from('classrooms')
        .update({ students: (row.students || []).map(patch), pending_students: (row.pending_students || []).map(patch) })
        .eq('id', row.id)
    )
  );

  return NextResponse.json({ success: true, student: { id: studentKey, ...fields } });
}
