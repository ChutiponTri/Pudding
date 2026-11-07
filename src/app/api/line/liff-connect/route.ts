import { NextRequest, NextResponse } from 'next/server';
import { LINE_TOKEN_HEADER } from '@/lib/auth/lineSession';
import { verifyLineToken } from '@/lib/auth/actor';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { leaveGroup } from '@/lib/line/messaging';
import {
  canLinkLine,
  canUnlinkLine,
  findTeacherByLineUid,
  getClassroom,
  linkErrorMessage,
  linkGroupByRef,
  listLinkableClassrooms,
  listTeacherGroups,
  unlinkClassroom,
  type LineTeacher,
  type ServiceClient,
} from '@/lib/line/groupLink';
import { teacherAccessMessage } from '@/lib/server/teacherProfileGuard';
import { classroomTitle } from '@/lib/utils/classroomLabel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Teacher's "connect a LINE group" page inside LINE (/liff/connect): opened
 * from the bot's button in a group (?g=<group ref>) or the rich menu. The
 * caller is the LINE account in the LIFF token, verified with LINE, and must
 * be an approved teacher's LINE sign-in. Students get 403 and no data. No
 * Clerk session is needed, so it works straight from LINE.
 */
async function liffTeacher(request: NextRequest): Promise<{ teacher: LineTeacher } | { response: NextResponse }> {
  const token = request.headers.get(LINE_TOKEN_HEADER);
  const lineUid = token ? await verifyLineToken(token) : null;
  if (!lineUid) return { response: NextResponse.json({ error: 'กรุณาเปิดหน้านี้จาก LINE อีกครั้ง', code: 'unauthorized' }, { status: 401 }) };
  const teacher = await findTeacherByLineUid(createServiceSupabaseClient(), lineUid);
  if (!teacher) {
    return { response: NextResponse.json({ error: 'หน้านี้สำหรับคุณครูเท่านั้น', code: 'not-teacher' }, { status: 403 }) };
  }
  if (teacher.access !== 'ok') {
    return { response: NextResponse.json({ error: teacherAccessMessage(teacher.access), code: teacher.access }, { status: 403 }) };
  }
  return { teacher };
}

function term(classroom: { semester?: number | null; year_ce?: number | null; academic_year?: string | null }) {
  return classroom.semester && classroom.year_ce ? `${classroom.semester}/${classroom.year_ce + 543}` : classroom.academic_year || '';
}

async function overview(supabase: ServiceClient, teacher: LineTeacher, focusRef?: string | null) {
  const classrooms = await listLinkableClassrooms(supabase, teacher.id);
  const { groups, focus } = await listTeacherGroups(supabase, teacher, classrooms, focusRef);
  const refByClassroom = new Map(groups.filter((group) => group.linkedClassroomId).map((group) => [group.linkedClassroomId as string, group.ref]));
  return {
    teacher: { firstName: teacher.first_name || '' },
    groups,
    focus,
    classrooms: classrooms.map((item) => ({
      id: item.id,
      title: classroomTitle(item),
      term: term(item),
      linked: Boolean(item.line_group_id),
      groupName: item.line_group_name || undefined,
      groupRef: refByClassroom.get(item.id),
      canUnlink: canUnlinkLine(item, teacher.id),
    })),
  };
}

export async function GET(request: NextRequest) {
  const caller = await liffTeacher(request);
  if ('response' in caller) return caller.response;
  return NextResponse.json(await overview(createServiceSupabaseClient(), caller.teacher, request.nextUrl.searchParams.get('g')));
}

export async function POST(request: NextRequest) {
  const caller = await liffTeacher(request);
  if ('response' in caller) return caller.response;
  const { teacher } = caller;
  const body = await request.json().catch(() => ({}));
  const action = body.action as 'link' | 'disconnect' | undefined;
  const classroomId = typeof body.classroomId === 'string' ? body.classroomId : '';
  const focusRef = typeof body.focusRef === 'string' ? body.focusRef : null;
  if (!action || !classroomId) return NextResponse.json({ error: 'action and classroomId are required' }, { status: 400 });

  const supabase = createServiceSupabaseClient();
  const classroom = await getClassroom(supabase, classroomId);
  if (!classroom || !canLinkLine(classroom, teacher.id)) return NextResponse.json({ error: 'ไม่พบห้องเรียนนี้' }, { status: 404 });

  if (action === 'link') {
    const ref = typeof body.groupRef === 'string' ? body.groupRef : '';
    if (!ref) return NextResponse.json({ error: 'กรุณาเลือกกลุ่ม LINE' }, { status: 400 });
    // Opened from a group's button: only that group can be linked here.
    if (focusRef && ref !== focusRef) return NextResponse.json({ error: 'เชื่อมได้เฉพาะกลุ่มที่เปิดหน้านี้มา' }, { status: 400 });
    const result = await linkGroupByRef(supabase, teacher, classroom, ref, { move: body.move === true });
    if (!result.ok) return NextResponse.json({ error: linkErrorMessage(result.reason), reason: result.reason }, { status: 409 });
  } else if (action === 'disconnect') {
    if (!canUnlinkLine(classroom, teacher.id)) return NextResponse.json({ error: 'การยกเลิกการเชื่อมทำได้โดยคุณครูเจ้าของห้อง' }, { status: 403 });
    const groupId = classroom.line_group_id;
    const { error } = await unlinkClassroom(supabase, classroom.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (groupId) {
      try {
        await leaveGroup(groupId);
      } catch (leaveError) {
        console.warn('LINE bot could not leave the group:', leaveError);
      }
    }
  } else {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }
  return NextResponse.json(await overview(supabase, teacher, focusRef));
}
