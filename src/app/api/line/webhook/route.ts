import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { getGroupSummary, isGroupMember, pushLineGroupText, replyLineText } from '@/lib/line/messaging';

export const runtime = 'nodejs';

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
type WaitingClassroom = {
  id: string;
  name: string;
  invite_code?: string | null;
  teacher_id?: string | null;
  teachers?: Array<{ teacher_id?: string }> | null;
  line_connection_token_expires_at?: string | null;
};

const CONNECT_HINT = 'ยังไม่พบห้องเรียนที่รอเชื่อมกลุ่มนี้\nให้คุณครูกด “เชื่อม LINE Group” ที่ห้องเรียนในเว็บ Pudding แล้วพิมพ์ข้อความใดก็ได้ในกลุ่มนี้';

/**
 * Links a LINE group to the classroom whose teacher asked to connect it.
 *
 * The teacher taps "เชื่อม LINE Group" on a classroom in the web UI, which marks
 * that classroom as waiting. LINE's join event does not say who added the bot,
 * so we look for waiting classrooms whose teacher is a member of this group.
 * - actorUserId given (a message was sent): match on that sender directly.
 * - otherwise (join event): ask LINE whether each waiting teacher is a member.
 *
 * Returns true when the event was fully handled (linked or replied).
 */
async function tryAutoLinkGroup(
  supabase: ServiceClient,
  groupId: string,
  replyToken: string | undefined,
  actorUserId?: string
): Promise<boolean> {
  const { data: alreadyLinked } = await supabase.from('classrooms').select('name').eq('line_group_id', groupId).maybeSingle();
  if (alreadyLinked) {
    if (!actorUserId) await replySafely(replyToken, `Pudding เชื่อมต่อแล้ว: ห้อง ${alreadyLinked.name}`);
    return !actorUserId;
  }

  const { data: waitingRows, error: waitingError } = await supabase
    .from('classrooms')
    .select('id, name, invite_code, teacher_id, teachers, line_connection_token_expires_at')
    .eq('line_connection_status', 'waiting')
    .is('line_group_id', null);
  if (waitingError) {
    console.error('LINE waiting classroom lookup failed:', waitingError);
    if (!actorUserId) await replySafely(replyToken, 'ระบบเชื่อมต่อ LINE ยังไม่พร้อม กรุณาติดต่อผู้ดูแลระบบ');
    return !actorUserId;
  }
  const now = Date.now();
  const waiting = ((waitingRows || []) as WaitingClassroom[]).filter(
    (item) => item.line_connection_token_expires_at && new Date(item.line_connection_token_expires_at).getTime() > now
  );

  const teacherIdsOf = (item: WaitingClassroom) =>
    [item.teacher_id, ...(item.teachers || []).map((t) => t.teacher_id)].filter(Boolean) as string[];
  const allTeacherIds = [...new Set(waiting.flatMap(teacherIdsOf))];
  const { data: teacherRows } = allTeacherIds.length
    ? await supabase.from('users').select('id, line_uid').in('id', allTeacherIds).not('line_uid', 'is', null)
    : { data: [] as Array<{ id: string; line_uid: string }> };
  const lineUidByTeacher = new Map((teacherRows || []).map((row) => [row.id, row.line_uid as string]));

  const membership = new Map<string, boolean>();
  const isMember = async (lineUid: string) => {
    if (actorUserId) return lineUid === actorUserId;
    if (!membership.has(lineUid)) {
      try {
        membership.set(lineUid, await isGroupMember(groupId, lineUid));
      } catch (error) {
        console.error('LINE group membership check failed:', error);
        membership.set(lineUid, false);
      }
    }
    return membership.get(lineUid)!;
  };

  const matches: WaitingClassroom[] = [];
  for (const item of waiting) {
    for (const teacherId of teacherIdsOf(item)) {
      const lineUid = lineUidByTeacher.get(teacherId);
      if (lineUid && (await isMember(lineUid))) {
        matches.push(item);
        break;
      }
    }
  }

  if (matches.length === 0) {
    // Stay quiet on ordinary group chat; only the join event explains what to do.
    if (!actorUserId) await replySafely(replyToken, CONNECT_HINT);
    return !actorUserId;
  }
  if (matches.length > 1) {
    await replySafely(replyToken, `พบห้องเรียนที่รอเชื่อมหลายห้อง (${matches.map((m) => m.name).join(', ')})\nกรุณาให้คุณครูกด “เชื่อม LINE Group” ทีละห้อง แล้วพิมพ์ข้อความในกลุ่มอีกครั้ง`);
    return true;
  }

  const classroom = matches[0];
  const summary = await getGroupSummary(groupId).catch(() => null);
  const { data: updated, error: updateError } = await supabase.from('classrooms').update({
    line_group_id: groupId,
    line_group_name: summary?.groupName || null,
    line_connection_status: 'connected',
    line_connection_token_hash: null,
    line_connection_token: null,
    line_connection_token_expires_at: null,
    line_connected_at: new Date().toISOString(),
  }).eq('id', classroom.id).is('line_group_id', null).select('id');
  if (updateError || !updated?.length) {
    console.error('LINE classroom auto-link failed:', updateError);
    await replySafely(replyToken, 'ระบบบันทึกการเชื่อมต่อไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
    return true;
  }
  await replySafely(
    replyToken,
    `✅ เชื่อมกลุ่มนี้กับห้องเรียน “${classroom.name}” เรียบร้อยแล้ว ระบบพร้อมส่งแจ้งเตือนการบ้าน\n\n${classroomJoinText(classroom, getLiffUrl())}`
  );
  return true;
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

  const payload = JSON.parse(body) as { events?: Array<{ type?: string; replyToken?: string; source?: { type?: string; groupId?: string; userId?: string }; message?: { type?: string; text?: string } }> };
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

    // Bot added to a group: link it to the classroom the teacher is connecting.
    if (groupId && event.type === 'join') {
      await tryAutoLinkGroup(supabase, groupId, event.replyToken);
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
      const { data: joinedClassroom } = await supabase.from('classrooms').select('id, name, invite_code').eq('line_group_id', groupId).maybeSingle();
      if (joinedClassroom) await replyClassroomJoinCode(event.replyToken, joinedClassroom, getLiffUrl());
      continue;
    }
    const normalizedText = (event.message?.type === 'text'
      ? event.message.text?.replace(/[​-‍﻿]/g, '').replace(/\s+/g, ' ').trim()
      : '') || '';
    const commandMatch = normalizedText.match(/^#pudding(?:\s+(.+))?$/i);
    const directJoinRequest = /^(?:#pudding\s+)?(?:join|code|ขอรหัส|ขอรหัสเข้าห้อง|รหัสเข้าห้อง|เข้าห้อง)$/i.test(normalizedText);
    if (!groupId && !lineUserId) continue;

    // The bot was added before the teacher tapped "connect" in the web UI: any
    // message from that teacher in the still-unlinked group completes the link.
    if (groupId && lineUserId && event.type === 'message') {
      if (await tryAutoLinkGroup(supabase, groupId, event.replyToken, lineUserId)) continue;
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
    else if (normalizedCommand === 'link') await replySafely(event.replyToken, liffUrl ? `เปิด Pudding: ${liffUrl}` : 'ยังไม่ได้ตั้งค่า LIFF URL');
    else if (normalizedCommand === 'status') await replySafely(event.replyToken, `ห้อง: ${groupClassroom.name}\nLINE Group: เชื่อมต่อแล้ว\nแจ้งเตือนงาน: พร้อมใช้งาน`);
    else if (normalizedCommand === 'attendance') await replySafely(event.replyToken, 'ระบบเช็กชื่อยังไม่ได้เปิดใช้งานใน Pudding');
  }
  return NextResponse.json({ ok: true });
}
