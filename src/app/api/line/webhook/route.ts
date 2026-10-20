import { createHmac, timingSafeEqual } from 'node:crypto';
import { after, NextRequest, NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { getGroupSummary, isGroupMember, pushLineGroupText, replyLineConfirm, replyLineText } from '@/lib/line/messaging';
import { withLiffLink } from '@/lib/line/liffLink';

export const runtime = 'nodejs';
// Leaves room for the delayed "last student joined" announcement (see handleMemberJoined).
export const maxDuration = 30;

function isValidSignature(body: string, signature: string | null) {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret || !signature) return false;
  const expected = createHmac('sha256', secret).update(body).digest('base64');
  return expected.length === signature.length && timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

function getLiffUrl() {
  const liffId = process.env.LINE_LIFF_ID || process.env.NEXT_PUBLIC_LINE_LIFF_ID;
  return liffId ? `https://liff.line.me/${liffId}` : null;
}

function normalizeCommand(command: string | undefined) {
  const aliases: Record<string, string> = {
    help: 'help',
    ช่วย: 'help',
    ช่วยเหลือ: 'help',
    คำสั่ง: 'help',
    status: 'status',
    สถานะ: 'status',
    test: 'test',
    ทดสอบ: 'test',
    link: 'link',
    ลิงก์: 'link',
    ลิงค์: 'link',
    attendance: 'attendance',
    'เช็กชื่อ': 'attendance',
    'เช็คชื่อ': 'attendance',
    join: 'join',
    code: 'join',
    'ขอรหัส': 'join',
    'ขอรหัสเข้าห้อง': 'join',
    'รหัสเข้าห้อง': 'join',
    'เข้าห้อง': 'join',
  };
  const value = (command || 'help').trim().toLowerCase();
  return aliases[value] || value;
}

async function replySafely(replyToken: string | undefined, text: string) {
  if (!replyToken) return;
  try {
    await replyLineText(replyToken, text);
  } catch (error) {
    console.error('LINE reply failed:', error);
  }
}

function classroomJoinText(classroom: { name: string; invite_code?: string | null; id: string }, liffUrl: string | null) {
  const joinUrl = liffUrl ? `${liffUrl}?classId=${encodeURIComponent(classroom.id)}` : null;
  const lines = [`🎓 ห้องเรียน: ${classroom.name}`];
  if (classroom.invite_code) lines.push(`รหัสเข้าห้อง: ${classroom.invite_code}`);
  if (joinUrl) lines.push(`กดลิงก์นี้เพื่อเข้าร่วม: ${joinUrl}`);
  lines.push('หากเป็นนักเรียนใหม่ ให้เปิดลิงก์ผ่าน LINE แล้วกรอกข้อมูลเพื่อส่งคำขอเข้าห้องเรียน');
  return lines.join('\n');
}

async function replyClassroomJoinCode(replyToken: string | undefined, classroom: { name: string; invite_code?: string | null; id: string }, liffUrl: string | null) {
  await replySafely(replyToken, classroomJoinText(classroom, liffUrl));
}

type ServiceClient = ReturnType<typeof createServiceSupabaseClient>;

/** Joins closer together than this count as one burst (a teacher inviting a class). */
const JOIN_QUIET_MS = 8000;

/**
 * Announces the classroom link when students join the LINE group, without
 * flooding it when a whole class is invited at once:
 * - the first join after a quiet period gets the link immediately (reply);
 * - later joins in the same burst stay silent, and once nobody has joined for
 *   JOIN_QUIET_MS the link is pushed once more for everyone who came late.
 * State lives on the classroom row because each join arrives as its own
 * webhook request (possibly on different instances).
 */
async function handleMemberJoined(supabase: ServiceClient, groupId: string, replyToken: string | undefined) {
  const { data: classroom } = await supabase.from('classrooms').select('id, name, invite_code').eq('line_group_id', groupId).maybeSingle();
  if (!classroom) return;
  const liffUrl = getLiffUrl();
  const joinedAt = new Date().toISOString();
  const quietSince = new Date(Date.now() - JOIN_QUIET_MS).toISOString();

  // Claim "first of the burst" atomically so concurrent joins can't both reply.
  const { data: first, error } = await supabase
    .from('classrooms')
    .update({ line_member_joined_at: joinedAt, line_join_notice_pending: false })
    .eq('id', classroom.id)
    .or(`line_member_joined_at.is.null,line_member_joined_at.lt.${quietSince}`)
    .select('id');
  if (error) {
    // Columns missing (migration not run): fall back to replying every time.
    console.error('LINE join burst tracking failed:', error);
    await replyClassroomJoinCode(replyToken, classroom, liffUrl);
    return;
  }
  if (first?.length) {
    await replyClassroomJoinCode(replyToken, classroom, liffUrl);
    return;
  }

  // Mid-burst: become the latest join (unless a newer one already is) ...
  const { data: latest } = await supabase
    .from('classrooms')
    .update({ line_member_joined_at: joinedAt, line_join_notice_pending: true })
    .eq('id', classroom.id)
    .lt('line_member_joined_at', joinedAt)
    .select('id');
  if (!latest?.length) return;

  // ... and if nobody joins after us, send the follow-up once.
  after(async () => {
    await new Promise((resolve) => setTimeout(resolve, JOIN_QUIET_MS));
    const { data: claimed } = await supabase
      .from('classrooms')
      .update({ line_join_notice_pending: false })
      .eq('id', classroom.id)
      .eq('line_member_joined_at', joinedAt)
      .eq('line_join_notice_pending', true)
      .select('id');
    if (!claimed?.length) return;
    try {
      await pushLineGroupText(groupId, classroomJoinText(classroom, liffUrl));
    } catch (err) {
      console.error('LINE join follow-up push failed:', err);
    }
  });
}
type LinkClassroom = {
  id: string;
  name: string;
  invite_code?: string | null;
  teacher_id?: string | null;
  teachers?: Array<{ teacher_id?: string }> | null;
  course_name?: string | null;
  semester?: number | null;
  year_ce?: number | null;
  academic_year?: string | null;
  line_group_id?: string | null;
  /** Clerk id of the teacher who tapped "เชื่อม LINE Group" (see /api/line/connections). */
  line_connection_token?: string | null;
  /** Group already shown the "move this group?" prompt, so ordinary chat does not repeat it. */
  line_connection_token_hash?: string | null;
  line_connection_token_expires_at?: string | null;
};

const LINK_COLUMNS = 'id, name, invite_code, teacher_id, teachers, course_name, semester, year_ce, academic_year, line_group_id, line_connection_token, line_connection_token_hash, line_connection_token_expires_at';

const CONNECT_HINT = 'ยังไม่พบห้องเรียนที่รอเชื่อมกลุ่มนี้\nให้คุณครูกด “เชื่อม LINE Group” ที่ห้องเรียนในเว็บ Pudding แล้วพิมพ์ข้อความใดก็ได้ในกลุ่มนี้';

const isTeacherOf = (classroom: LinkClassroom, teacherId: string) =>
  classroom.teacher_id === teacherId || (classroom.teachers || []).some((t) => t.teacher_id === teacherId);

function classroomLabel(classroom: LinkClassroom) {
  const term = classroom.semester && classroom.year_ce
    ? `ภาคเรียน ${classroom.semester}/${classroom.year_ce + 543}`
    : classroom.academic_year || '';
  return [`“${classroom.name}”`, classroom.course_name, term].filter(Boolean).join(' · ');
}

/** The classroom this LINE group is linked to, if any. */
async function findLinkedClassroom(supabase: ServiceClient, groupId: string): Promise<LinkClassroom | null> {
  const { data } = await supabase.from('classrooms').select(LINK_COLUMNS).eq('line_group_id', groupId).limit(1);
  return ((data || []) as LinkClassroom[])[0] || null;
}

/** Registered teacher behind a LINE user id (students and strangers return null). */
async function findTeacherByLineUid(supabase: ServiceClient, lineUserId: string) {
  const { data } = await supabase.from('users').select('id, first_name').eq('line_uid', lineUserId).eq('role', 'teacher').maybeSingle();
  return data as { id: string; first_name?: string | null } | null;
}

/**
 * Classrooms still waiting for a group, optionally only those requested by one
 * teacher. Expired requests and requesters who are no longer a teacher of the
 * classroom are dropped.
 */
async function findWaitingClassrooms(supabase: ServiceClient, requesterId?: string): Promise<LinkClassroom[]> {
  let query = supabase
    .from('classrooms')
    .select(LINK_COLUMNS)
    .eq('line_connection_status', 'waiting')
    .is('line_group_id', null)
    .not('line_connection_token', 'is', null);
  if (requesterId) query = query.eq('line_connection_token', requesterId);
  const { data, error } = await query;
  if (error) {
    console.error('LINE waiting classroom lookup failed:', error);
    return [];
  }
  const now = Date.now();
  return ((data || []) as LinkClassroom[]).filter(
    (item) =>
      item.line_connection_token_expires_at &&
      new Date(item.line_connection_token_expires_at).getTime() > now &&
      isTeacherOf(item, item.line_connection_token as string)
  );
}

/**
 * Links the group to `classroom`. When `replacing` is given (the teacher
 * confirmed moving an old group), that classroom is unlinked first; nothing is
 * changed if the group's link moved on in the meantime.
 */
async function linkGroup(
  supabase: ServiceClient,
  groupId: string,
  classroom: LinkClassroom,
  replyToken: string | undefined,
  replacing?: LinkClassroom
) {
  if (replacing) {
    const { data: unlinked } = await supabase.from('classrooms').update({
      line_group_id: null,
      line_group_name: null,
      line_connection_status: 'disconnected',
      line_connected_at: null,
    }).eq('id', replacing.id).eq('line_group_id', groupId).select('id');
    if (!unlinked?.length) {
      await replySafely(replyToken, 'สถานะกลุ่มเปลี่ยนไปแล้ว กรุณาพิมพ์ข้อความในกลุ่มอีกครั้ง');
      return;
    }
  } else if (await findLinkedClassroom(supabase, groupId)) {
    await replySafely(replyToken, 'กลุ่มนี้เชื่อมกับห้องเรียนอื่นแล้ว');
    return;
  }

  const summary = await getGroupSummary(groupId).catch(() => null);
  const { data: updated, error: updateError } = await supabase.from('classrooms').update({
    line_group_id: groupId,
    line_group_name: summary?.groupName || null,
    line_connection_status: 'connected',
    line_connection_token_hash: null,
    line_connection_token: null,
    line_connection_token_expires_at: null,
    line_connected_at: new Date().toISOString(),
  }).eq('id', classroom.id).eq('line_connection_status', 'waiting').is('line_group_id', null).select('id');
  if (updateError || !updated?.length) {
    console.error('LINE classroom link failed:', updateError);
    if (replacing) {
      // Put the old link back rather than leave the group linked to nothing.
      await supabase.from('classrooms').update({
        line_group_id: groupId,
        line_group_name: summary?.groupName || null,
        line_connection_status: 'connected',
        line_connected_at: new Date().toISOString(),
      }).eq('id', replacing.id).is('line_group_id', null);
    }
    await replySafely(replyToken, 'ระบบบันทึกการเชื่อมต่อไม่สำเร็จ กรุณากด “เชื่อม LINE Group” ในเว็บแล้วลองใหม่อีกครั้ง');
    return;
  }
  await replySafely(
    replyToken,
    `✅ เชื่อมกลุ่มนี้กับห้องเรียน “${classroom.name}” เรียบร้อยแล้ว${replacing ? ` (ยกเลิกการเชื่อมกับห้อง “${replacing.name}”)` : ''} ระบบพร้อมส่งแจ้งเตือนการบ้าน\n\n${classroomJoinText(classroom, getLiffUrl())}`
  );
}

/** Asks the requesting teacher to confirm before a group is linked or moved. */
async function promptLink(replyToken: string | undefined, classroom: LinkClassroom, text: string, replacing?: LinkClassroom) {
  if (!replyToken) return;
  const yes = new URLSearchParams({ pudding: 'link', classroomId: classroom.id });
  if (replacing) yes.set('replace', replacing.id);
  try {
    await replyLineConfirm(
      replyToken,
      text,
      { label: replacing ? 'ย้ายมาห้องนี้' : 'เชื่อมกลุ่ม', data: yes.toString() },
      { label: 'ยกเลิก', data: new URLSearchParams({ pudding: 'cancel', classroomId: classroom.id }).toString() }
    );
  } catch (error) {
    console.error('LINE confirm reply failed:', error);
  }
}

/**
 * Bot added to a group. LINE does not say who added it, so nothing is linked
 * here: if a teacher who tapped "เชื่อม LINE Group" is in the group, they get a
 * confirm button that only their own tap (or message) can complete.
 */
async function handleBotJoined(supabase: ServiceClient, groupId: string, replyToken: string | undefined) {
  const linked = await findLinkedClassroom(supabase, groupId);
  if (linked) {
    await replySafely(replyToken, `Pudding เชื่อมต่อแล้ว: ห้อง ${linked.name}`);
    return;
  }
  const waiting = await findWaitingClassrooms(supabase);
  const requesterIds = [...new Set(waiting.map((item) => item.line_connection_token as string))];
  const { data: requesters } = requesterIds.length
    ? await supabase.from('users').select('id, line_uid').in('id', requesterIds).not('line_uid', 'is', null)
    : { data: [] as Array<{ id: string; line_uid: string }> };
  const matches: LinkClassroom[] = [];
  for (const requester of requesters || []) {
    let member = false;
    try {
      member = await isGroupMember(groupId, requester.line_uid as string);
    } catch (error) {
      console.error('LINE group membership check failed:', error);
    }
    if (member) matches.push(...waiting.filter((item) => item.line_connection_token === requester.id));
  }

  if (matches.length === 1) {
    await promptLink(replyToken, matches[0], `เชื่อมกลุ่มนี้กับห้องเรียน ${classroomLabel(matches[0])}?\n(เฉพาะคุณครูที่กดเชื่อมในเว็บเท่านั้นที่กดยืนยันได้)`);
  } else if (matches.length > 1) {
    await replySafely(replyToken, 'คุณครูที่กด “เชื่อม LINE Group” ในเว็บ กรุณาพิมพ์ข้อความใดก็ได้ในกลุ่มนี้เพื่อเชื่อมห้องเรียน');
  } else {
    await replySafely(replyToken, CONNECT_HINT);
  }
}

/**
 * A message in a group. Only the teacher who tapped "เชื่อม LINE Group" can
 * link it; messages from anyone else (students, other teachers) are ignored.
 * A group already linked to another classroom is never taken silently: its
 * own teacher is asked to confirm the move (e.g. reusing last semester's
 * group), and other teachers' groups are refused.
 *
 * Returns true when the message was used for linking.
 */
async function handleLinkMessage(supabase: ServiceClient, groupId: string, lineUserId: string, replyToken: string | undefined): Promise<boolean> {
  const teacher = await findTeacherByLineUid(supabase, lineUserId);
  if (!teacher) return false;
  const [classroom] = await findWaitingClassrooms(supabase, teacher.id);
  if (!classroom) return false;

  const linked = await findLinkedClassroom(supabase, groupId);
  if (!linked) {
    await linkGroup(supabase, groupId, classroom, replyToken);
    return true;
  }
  // Ask once per group; later chat while still waiting goes through as normal.
  if (classroom.line_connection_token_hash === groupId) return false;
  await supabase.from('classrooms').update({ line_connection_token_hash: groupId }).eq('id', classroom.id);
  if (isTeacherOf(linked, teacher.id)) {
    await promptLink(
      replyToken,
      classroom,
      `กลุ่มนี้เชื่อมกับห้อง ${classroomLabel(linked)} อยู่แล้ว\nย้ายกลุ่มนี้มาใช้กับห้อง ${classroomLabel(classroom)} แทนหรือไม่?`,
      linked
    );
  } else {
    await replySafely(replyToken, `กลุ่มนี้เชื่อมกับห้องเรียน “${linked.name}” ของคุณครูท่านอื่นแล้ว จึงเชื่อมกับห้อง “${classroom.name}” ไม่ได้\nกรุณาใช้กลุ่ม LINE อื่น`);
  }
  return true;
}

/** Taps on the confirm buttons sent by promptLink. Only the requesting teacher's tap counts. */
async function handleLinkPostback(supabase: ServiceClient, groupId: string, lineUserId: string | undefined, data: string, replyToken: string | undefined) {
  const params = new URLSearchParams(data);
  const classroomId = params.get('classroomId');
  if (!classroomId || !lineUserId) return;
  const teacher = await findTeacherByLineUid(supabase, lineUserId);
  const classroom = teacher ? (await findWaitingClassrooms(supabase, teacher.id)).find((item) => item.id === classroomId) : undefined;
  if (!teacher || !classroom) {
    await replySafely(replyToken, 'เฉพาะคุณครูที่กด “เชื่อม LINE Group” ในเว็บเท่านั้นที่ยืนยันได้ (หรือคำขอหมดอายุแล้ว)');
    return;
  }

  if (params.get('pudding') === 'cancel') {
    await supabase.from('classrooms').update({
      line_connection_status: 'disconnected',
      line_connection_token: null,
      line_connection_token_hash: null,
      line_connection_token_expires_at: null,
    }).eq('id', classroom.id).eq('line_connection_status', 'waiting');
    await replySafely(replyToken, `ยกเลิกการเชื่อมห้อง “${classroom.name}” แล้ว`);
    return;
  }

  const linked = await findLinkedClassroom(supabase, groupId);
  const replaceId = params.get('replace');
  if (!linked) {
    await linkGroup(supabase, groupId, classroom, replyToken);
  } else if (linked.id === replaceId && isTeacherOf(linked, teacher.id)) {
    await linkGroup(supabase, groupId, classroom, replyToken, linked);
  } else {
    await replySafely(replyToken, `กลุ่มนี้เชื่อมกับห้องเรียน “${linked.name}” อยู่ จึงไม่ได้เปลี่ยนแปลงอะไร`);
  }
}

/**
 * LINE webhook. Teachers are recognised by the LINE id copied from their LINE
 * sign-in (see syncTeacherLineIdentity); groups link and unlink automatically
 * when the bot joins or leaves.
 */
export async function POST(request: NextRequest) {
  const body = await request.text();
  if (!isValidSignature(body, request.headers.get('x-line-signature'))) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const payload = JSON.parse(body) as { events?: Array<{ type?: string; replyToken?: string; source?: { type?: string; groupId?: string; userId?: string }; message?: { type?: string; text?: string }; postback?: { data?: string } }> };
  let supabase;
  try {
    supabase = createServiceSupabaseClient();
  } catch (error) {
    console.error('LINE Supabase service client configuration failed:', error);
    for (const event of payload.events || []) {
      await replySafely(event.replyToken, error instanceof Error && error.message.includes('SUPABASE_SERVICE_ROLE_KEY')
        ? 'ระบบยังไม่ได้ตั้งค่า SUPABASE_SERVICE_ROLE_KEY บนระบบที่ deploy'
        : 'ระบบยังไม่ได้ตั้งค่า Supabase URL บนระบบที่ deploy');
    }
    return NextResponse.json({ error: 'Supabase service configuration is missing' }, { status: 503 });
  }
  for (const event of payload.events || []) {
    const groupId = event.source?.type === 'group' ? event.source.groupId : undefined;
    const lineUserId = event.source?.userId;

    // Bot added to a group: offer the waiting teacher a confirm button.
    if (groupId && event.type === 'join') {
      await handleBotJoined(supabase, groupId, event.replyToken);
      continue;
    }
    if (groupId && event.type === 'postback') {
      const data = event.postback?.data || '';
      if (new URLSearchParams(data).has('pudding')) await handleLinkPostback(supabase, groupId, lineUserId, data, event.replyToken);
      continue;
    }
    // Bot removed from (or left) a group: unlink that classroom in the UI.
    if (groupId && event.type === 'leave') {
      const { error } = await supabase.from('classrooms').update({
        line_group_id: null,
        line_group_name: null,
        line_connection_status: 'disconnected',
        line_connection_token_expires_at: null,
        line_connected_at: null,
      }).eq('line_group_id', groupId);
      if (error) console.error('LINE classroom auto-unlink failed:', error);
      continue;
    }
    // Teacher adds / blocks the bot in their 1:1 chat.
    if (!groupId && lineUserId && (event.type === 'follow' || event.type === 'unfollow')) {
      const { data: teacher } = await supabase
        .from('users')
        .update({ line_bot_friend: event.type === 'follow' })
        .eq('line_uid', lineUserId)
        .eq('role', 'teacher')
        .select('first_name')
        .maybeSingle();
      if (event.type === 'follow') {
        const liffUrl = getLiffUrl();
        await replySafely(event.replyToken, teacher
          ? `สวัสดีคุณครู${teacher.first_name ? ` ${teacher.first_name}` : ''} 🍮\nบัญชี LINE ของคุณเชื่อมกับ Pudding แล้ว\nเชื่อม LINE Group: กด “เชื่อม LINE Group” ที่ห้องเรียนในเว็บ แล้วเพิ่มบอทเข้ากลุ่ม`
          : `ยินดีต้อนรับสู่ Pudding 🍮${liffUrl ? `\nนักเรียนเปิดห้องเรียนได้ที่: ${liffUrl}` : ''}`);
      }
      continue;
    }
    if (groupId && event.type === 'memberJoined') {
      await handleMemberJoined(supabase, groupId, event.replyToken);
      continue;
    }
    const normalizedText = (event.message?.type === 'text'
      ? event.message.text?.replace(/[​-‍﻿]/g, '').replace(/\s+/g, ' ').trim()
      : '') || '';
    const commandMatch = normalizedText.match(/^#pudding(?:\s+(.+))?$/i);
    const directJoinRequest = /^(?:#pudding\s+)?(?:join|code|ขอรหัส|ขอรหัสเข้าห้อง|รหัสเข้าห้อง|เข้าห้อง)$/i.test(normalizedText);
    if (!groupId && !lineUserId) continue;

    // The bot was added before the teacher tapped "connect" in the web UI: any
    // message from that same teacher in the group completes the link.
    if (groupId && lineUserId && event.type === 'message') {
      if (await handleLinkMessage(supabase, groupId, lineUserId, event.replyToken)) continue;
    }

    // Ignore ordinary group messages. Only explicit Pudding commands continue below.
    if (!commandMatch && !directJoinRequest) continue;
    const rawCommand = directJoinRequest ? 'join' : (commandMatch?.[1] || '').trim();
    const [command, ...args] = rawCommand.split(/\s+/);
    const normalizedCommand = normalizeCommand(command);
    const liffUrl = getLiffUrl();

    const { data: linkedTeacher } = lineUserId
      ? await supabase.from('users').select('id, first_name, last_name, role').eq('line_uid', lineUserId).eq('role', 'teacher').maybeSingle()
      : { data: null };

    if (!groupId) {
      if (normalizedCommand === 'help') {
        await replySafely(event.replyToken, '#pudding status ตรวจสถานะ\n#pudding test ทดสอบแจ้งเตือน\n#pudding link เปิด Pudding\n#pudding attendance สถานะเช็กชื่อ');
        continue;
      }
      if (normalizedCommand === 'link') {
        await replySafely(event.replyToken, liffUrl ? `เปิด Pudding: ${liffUrl}` : 'ยังไม่ได้ตั้งค่า LIFF URL');
        continue;
      }
      if (!linkedTeacher) {
        await replySafely(event.replyToken, 'บัญชี LINE นี้ยังไม่ได้เชื่อมกับบัญชีครูใน Pudding กรุณาเข้าสู่ระบบเว็บ Pudding ด้วย LINE');
        continue;
      }
      const { data: allTeacherClasses } = await supabase.from('classrooms').select('id, name, teacher_id, teachers, line_group_id, line_connection_status');
      const teacherClasses = (allTeacherClasses || []).filter((item) => item.teacher_id === linkedTeacher.id || (item.teachers || []).some((teacher: { teacher_id?: string }) => teacher.teacher_id === linkedTeacher.id));
      if (normalizedCommand === 'status') {
        const connected = (teacherClasses || []).filter((item) => item.line_group_id);
        await replySafely(event.replyToken, `เชื่อมต่อแล้ว ${connected.length}/${(teacherClasses || []).length} ห้อง\nแจ้งเตือน: ${connected.length ? 'พร้อมใช้งาน' : 'ยังไม่พร้อม'}`);
      } else if (normalizedCommand === 'test') {
        const target = args[0] ? (teacherClasses || []).find((item) => item.id === args[0] || item.name === args.join(' ')) : (teacherClasses || []).length === 1 ? teacherClasses?.[0] : undefined;
        if (!target) {
          await replySafely(event.replyToken, (teacherClasses || []).length > 1 ? 'มีหลายห้อง กรุณาระบุ classroom ID หลังคำสั่ง test' : 'ยังไม่มีห้องที่เชื่อม LINE Group');
        } else if (!target.line_group_id) {
          await replySafely(event.replyToken, 'ห้องนี้ยังไม่ได้เชื่อม LINE Group');
        } else {
          try {
            await pushLineGroupText(target.line_group_id, `✅ ทดสอบแจ้งเตือนจาก Pudding: ${target.name}`);
            await replySafely(event.replyToken, 'ส่งข้อความทดสอบแล้ว');
          } catch (error) {
            console.error('LINE teacher test push failed:', error);
            await replySafely(event.replyToken, 'ส่งข้อความทดสอบไม่สำเร็จ กรุณาตรวจการตั้งค่า LINE Bot');
          }
        }
      } else if (normalizedCommand === 'attendance') {
        await replySafely(event.replyToken, 'ระบบเช็กชื่อยังไม่ได้เปิดใช้งานใน Pudding');
      } else {
        await replySafely(event.replyToken, 'ไม่รู้จักคำสั่ง ใช้ #pudding help เพื่อดูคำสั่งที่ใช้ได้');
      }
      continue;
    }

    const { data: groupClassroom } = await supabase.from('classrooms').select('id, name, teacher_id, teachers, line_group_id, invite_code').eq('line_group_id', groupId).maybeSingle();
    if (!groupClassroom) {
      if (normalizedCommand === 'help') await replySafely(event.replyToken, '#pudding join หรือ “ขอรหัสเข้าห้อง” ขอรหัส/ลิงก์เข้าห้อง\n#pudding link เปิด Pudding\n#pudding status ดูสถานะกลุ่ม');
      else if (normalizedCommand === 'link') await replySafely(event.replyToken, liffUrl ? `เปิด Pudding: ${liffUrl}` : 'ยังไม่ได้ตั้งค่า LIFF URL');
      else if (normalizedCommand === 'status') await replySafely(event.replyToken, 'กลุ่มนี้ยังไม่ได้เชื่อมกับห้องเรียนใน Pudding');
      continue;
    }
    if (normalizedCommand === 'help') await replySafely(event.replyToken, '#pudding join หรือ “ขอรหัสเข้าห้อง” ขอรหัส/ลิงก์เข้าห้อง\n#pudding link เปิด Pudding\n#pudding status ดูสถานะกลุ่ม');
    else if (normalizedCommand === 'join') await replyClassroomJoinCode(event.replyToken, groupClassroom, liffUrl);
    else if (normalizedCommand === 'link') await replySafely(event.replyToken, withLiffLink(`🎓 ห้องเรียน: ${groupClassroom.name}`, 'เปิดห้องเรียนใน Pudding', { classroomId: groupClassroom.id }));
    else if (normalizedCommand === 'status') await replySafely(event.replyToken, `ห้อง: ${groupClassroom.name}\nLINE Group: เชื่อมต่อแล้ว\nแจ้งเตือนงาน: พร้อมใช้งาน`);
    else if (normalizedCommand === 'attendance') await replySafely(event.replyToken, withLiffLink(`⏰ เช็คชื่อ: ${groupClassroom.name}`, 'กดเพื่อเช็คชื่อ', { classroomId: groupClassroom.id, view: 'attendance' }));
  }
  return NextResponse.json({ ok: true });
}
