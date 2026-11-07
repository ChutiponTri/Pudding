import { NextRequest, NextResponse } from 'next/server';
import { LINE_TOKEN_HEADER } from '@/lib/auth/lineSession';
import { verifyLineToken } from '@/lib/auth/actor';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { leaveGroup } from '@/lib/line/messaging';
import {
  armConnectRequest,
  canLinkLine,
  canUnlinkLine,
  cancelConnectRequest,
  findCandidateGroups,
  findTeacherByLineUid,
  getClassroom,
  linkCandidateGroup,
  linkErrorMessage,
  listLinkableClassrooms,
  signalLineStatus,
  unlinkClassroom,
  type LineTeacher,
  type ServiceClient,
} from '@/lib/line/groupLink';
import { teacherAccessMessage } from '@/lib/server/teacherProfileGuard';
import { classroomTitle } from '@/lib/utils/classroomLabel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Teacher's "connect a LINE group" page inside LINE (/liff/connect, the rich
 * menu's link). The caller is the LINE account in the LIFF token, verified
 * with LINE; it must be an approved teacher's LINE sign-in. No Clerk session
 * is needed, so it works straight from the LINE chat.
 */
async function liffTeacher(request: NextRequest): Promise<{ teacher: LineTeacher } | { response: NextResponse }> {
  const token = request.headers.get(LINE_TOKEN_HEADER);
  const lineUid = token ? await verifyLineToken(token) : null;
  if (!lineUid) return { response: NextResponse.json({ error: 'กรุณาเปิดหน้านี้จาก LINE อีกครั้ง', code: 'unauthorized' }, { status: 401 }) };
  const teacher = await findTeacherByLineUid(createServiceSupabaseClient(), lineUid);
  if (!teacher) {
    return { response: NextResponse.json({ error: 'บัญชี LINE นี้ยังไม่ได้เชื่อมกับบัญชีครูใน Pudding กรุณาเข้าสู่ระบบเว็บ Pudding ด้วย LINE (บัญชีเดียวกัน) ก่อน', code: 'not-teacher' }, { status: 403 }) };
  }
  if (teacher.access !== 'ok') {
    return { response: NextResponse.json({ error: teacherAccessMessage(teacher.access), code: teacher.access }, { status: 403 }) };
  }
  return { teacher };
}

function term(classroom: { semester?: number | null; year_ce?: number | null; academic_year?: string | null }) {
  return classroom.semester && classroom.year_ce ? `${classroom.semester}/${classroom.year_ce + 543}` : classroom.academic_year || '';
}

async function overview(supabase: ServiceClient, teacher: LineTeacher) {
  const [classrooms, candidates] = await Promise.all([
    listLinkableClassrooms(supabase, teacher.id),
    findCandidateGroups(supabase, teacher.lineUid),
  ]);
  const now = Date.now();
  return {
    teacher: { firstName: teacher.first_name || '' },
    candidates,
    classrooms: classrooms.map((item) => {
      const waiting = item.line_connection_status === 'waiting'
        && item.line_connection_token === teacher.id
        && Boolean(item.line_connection_token_expires_at && new Date(item.line_connection_token_expires_at).getTime() > now);
      return {
        id: item.id,
        title: classroomTitle(item),
        term: term(item),
        status: item.line_group_id ? 'connected' : waiting ? 'waiting' : 'disconnected',
        groupName: item.line_group_name || undefined,
        expiresAt: waiting ? item.line_connection_token_expires_at : undefined,
        canUnlink: canUnlinkLine(item, teacher.id),
      };
    }),
  };
}

export async function GET(request: NextRequest) {
  const caller = await liffTeacher(request);
  if ('response' in caller) return caller.response;
  return NextResponse.json(await overview(createServiceSupabaseClient(), caller.teacher));
}

export async function POST(request: NextRequest) {
  const caller = await liffTeacher(request);
  if ('response' in caller) return caller.response;
  const { teacher } = caller;
  const body = await request.json().catch(() => ({}));
  const action = body.action as 'arm' | 'link-group' | 'cancel' | 'disconnect' | undefined;
  const classroomId = typeof body.classroomId === 'string' ? body.classroomId : '';
  if (!action || !classroomId) return NextResponse.json({ error: 'action and classroomId are required' }, { status: 400 });

  const supabase = createServiceSupabaseClient();
  const classroom = await getClassroom(supabase, classroomId);
  if (!classroom || !canLinkLine(classroom, teacher.id)) return NextResponse.json({ error: 'ไม่พบห้องเรียนนี้' }, { status: 404 });

  if (action === 'arm') {
    if (classroom.line_group_id) return NextResponse.json({ error: linkErrorMessage('classroom-taken') }, { status: 409 });
    const armed = await armConnectRequest(supabase, teacher.id, classroom.id);
    if (armed.error) return NextResponse.json({ error: armed.error }, { status: 500 });
    signalLineStatus(classroom.id);
  } else if (action === 'link-group') {
    const groupId = typeof body.groupId === 'string' ? body.groupId : '';
    if (!groupId) return NextResponse.json({ error: 'groupId is required' }, { status: 400 });
    const result = await linkCandidateGroup(supabase, teacher, classroom, groupId);
    if (!result.ok) return NextResponse.json({ error: linkErrorMessage(result.reason) }, { status: 409 });
  } else if (action === 'cancel') {
    if (classroom.line_connection_token === teacher.id) {
      await cancelConnectRequest(supabase, classroom.id);
      signalLineStatus(classroom.id);
    }
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
  return NextResponse.json(await overview(supabase, teacher));
}
