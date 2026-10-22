import { auth } from '@clerk/nextjs/server';
import { after, NextRequest, NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { pushLineGroupText } from '@/lib/line/messaging';
import { withLiffLink } from '@/lib/line/liffLink';
import { signalClassroom } from '@/lib/realtime/classroomSignal';
import { formatDateTime, SCHOOL_TIME_ZONE } from '@/lib/utils/datetime';
import { isAssignmentPublished } from '@/lib/utils/assignmentWindow';
import type { Assignment, SubmissionOverrideStatus } from '@/types/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUSES: SubmissionOverrideStatus[] = ['auto', 'force_closed', 'extended'];

/**
 * Teacher changes whether an assignment accepts work: back to the deadline,
 * close now, or extend. Closing and extending are announced in the classroom's
 * LINE group so students know right away.
 */
export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const assignmentId = typeof body.assignmentId === 'string' ? body.assignmentId : '';
  const status = body.status_override as SubmissionOverrideStatus;
  const extendedUntil = typeof body.extended_until === 'string' ? body.extended_until : undefined;
  if (!assignmentId || !STATUSES.includes(status)) {
    return NextResponse.json({ error: 'assignmentId and a valid status_override are required' }, { status: 400 });
  }
  const extendedMs = extendedUntil ? new Date(extendedUntil).getTime() : NaN;
  if (status === 'extended' && (Number.isNaN(extendedMs) || extendedMs <= Date.now())) {
    return NextResponse.json({ error: 'กรุณาเลือกเวลาขยายที่อยู่ในอนาคต' }, { status: 400 });
  }

  const supabase = createServiceSupabaseClient();
  const { data: previous } = await supabase.from('assignments').select('*').eq('id', assignmentId).maybeSingle<Assignment>();
  if (!previous) return NextResponse.json({ error: 'ไม่พบงานนี้' }, { status: 404 });

  const { data: classroom } = await supabase
    .from('classrooms')
    .select('id, name, teacher_id, teachers, line_group_id')
    .eq('id', previous.classroom_id)
    .maybeSingle();
  const isTeacher =
    classroom?.teacher_id === userId ||
    (classroom?.teachers || []).some((teacher: { teacher_id?: string }) => teacher.teacher_id === userId);
  if (!classroom || !isTeacher) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const patch: Partial<Assignment> = { status_override: status };
  if (status === 'extended') patch.extended_until = new Date(extendedMs).toISOString();
  const { data: updated, error } = await supabase.from('assignments').update(patch).eq('id', assignmentId).select('*').maybeSingle<Assignment>();
  if (error || !updated) {
    console.error('Assignment override update failed:', error);
    return NextResponse.json({ error: 'บันทึกสถานะการรับงานไม่สำเร็จ' }, { status: 500 });
  }

  // Announce only real changes to work students can already see.
  const changed =
    previous.status_override !== status ||
    (status === 'extended' && new Date(previous.extended_until || 0).getTime() !== extendedMs);
  const lineGroupId = classroom.line_group_id;
  if (changed && lineGroupId && isAssignmentPublished(updated) && (status === 'force_closed' || status === 'extended')) {
    const kind = updated.is_exam ? 'ข้อสอบ' : 'งาน';
    const message =
      status === 'force_closed'
        ? `🔒 ปิดรับ${kind}แล้ว\n${updated.title}\nห้อง: ${classroom.name}\n\nคุณครูปิดรับ${kind}นี้แล้ว นักเรียนไม่สามารถส่งเพิ่มได้`
        : withLiffLink(
            `⏳ ขยายเวลาส่ง${kind}\n${updated.title}\nห้อง: ${classroom.name}\n\nส่งได้ถึง: ${formatDateTime(updated.extended_until, 'th', SCHOOL_TIME_ZONE)}`,
            updated.is_exam ? 'กดเพื่อทำข้อสอบ' : 'กดเพื่อส่งงาน',
            { classroomId: classroom.id, assignmentId: updated.id }
          );
    after(async () => {
      try {
        await pushLineGroupText(lineGroupId, message);
      } catch (lineError) {
        console.error('Override LINE push failed:', lineError);
      }
    });
  }
  // Open student pages pick up the new status.
  after(() => signalClassroom(classroom.id, { type: 'timeline' }));

  return NextResponse.json({ assignment: updated });
}
