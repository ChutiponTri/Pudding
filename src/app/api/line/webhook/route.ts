import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { getGroupSummary, pushLineGroupText, replyLineButtons, replyLineText, replyLineTextWithLinkButton, replyLineTextWithQuickReplies, type LineAction } from '@/lib/line/messaging';
import {
  connectGuideImage,
  ensureBotGroup,
  findLinkedClassroom,
  findTeacherByLineUid,
  forgetBotGroup,
  liffConnectUrl,
  listLinkableClassrooms,
  signalLineStatus,
  webUrl,
  type LinkClassroom,
  type ServiceClient,
} from '@/lib/line/groupLink';
import { buildLiffUrl, withLiffLink } from '@/lib/line/liffLink';
import { answerTeacherQuestion, faqMenuButtons, type BotReply } from '@/lib/line/teacherFaq';
import { parseStudentCommand, studentHelpText, type StudentCommand } from '@/lib/line/studentCommands';
import { getAssignmentWindow } from '@/lib/utils/assignmentWindow';
import { formatDateTime, SCHOOL_TIME_ZONE } from '@/lib/utils/datetime';
import { classroomTitle, type LabelledClassroom } from '@/lib/utils/classroomLabel';
import type { Assignment } from '@/types/database';
import { reserveLineTestSend, releaseLineTestSend } from '@/lib/server/lineTestQuota';
import { teacherAccessMessage } from '@/lib/server/teacherProfileGuard';
import { teacherAccessOf } from '@/lib/utils/teacherProfile';

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
    'เช็คชื่อ': 'attendance', // old spelling people still type
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

/** FAQ / welcome reply with its next-step buttons. */
async function replyBotSafely(replyToken: string | undefined, reply: BotReply) {
  if (!replyToken) return;
  try {
    await replyLineTextWithQuickReplies(replyToken, reply.text, reply.quickReplies);
  } catch (error) {
    console.error('LINE reply failed:', error);
  }
}

async function replySafely(replyToken: string | undefined, text: string) {
  if (!replyToken) return;
  try {
    await replyLineText(replyToken, text);
  } catch (error) {
    console.error('LINE reply failed:', error);
  }
}

// The invite code (not the guessable classroom id) is what lets a new student join.
function classroomJoinUrl(classroom: { invite_code?: string | null }, liffUrl: string | null) {
  return liffUrl && classroom.invite_code ? `${liffUrl}?code=${encodeURIComponent(classroom.invite_code)}` : null;
}

function classroomJoinText(classroom: LabelledClassroom & { invite_code?: string | null; id: string }, liffUrl: string | null) {
  const joinUrl = classroomJoinUrl(classroom, liffUrl);
  const lines = [`🎓 ${classroomTitle(classroom)}`];
  if (classroom.invite_code) lines.push(`รหัสเข้าห้อง: ${classroom.invite_code}`);
  if (joinUrl) {
    lines.push(`กดลิงก์นี้เพื่อเข้าร่วม: ${joinUrl}`);
    lines.push('หากเป็นนักเรียนใหม่ ให้กดปุ่มเข้าร่วมใน LINE แล้วกรอกข้อมูลเพื่อส่งคำขอเข้าห้องเรียน');
  }
  return lines.join('\n');
}

/** Join code text, plus a "เข้าร่วมห้องเรียน" button under it when there is a join link. */
async function replyClassroomJoinCode(replyToken: string | undefined, classroom: LabelledClassroom & { invite_code?: string | null; id: string }, liffUrl: string | null) {
  const text = classroomJoinText(classroom, liffUrl);
  const joinUrl = classroomJoinUrl(classroom, liffUrl);
  if (!replyToken || !joinUrl) return replySafely(replyToken, text);
  try {
    await replyLineTextWithLinkButton(replyToken, text, {
      text: `🎓 ${classroomTitle(classroom)}\nกดปุ่มด้านล่างเพื่อเข้าร่วมห้องเรียน`,
      label: 'เข้าร่วมห้องเรียน',
      uri: joinUrl,
    });
  } catch (error) {
    console.error('LINE join button reply failed:', error);
    // A reply token works once; it is still unused when LINE rejected the message.
    await replySafely(replyToken, text);
  }
}

/** Joins closer together than this count as one burst (a teacher inviting a class). */
const JOIN_QUIET_MS = 8000;

/**
 * Announces the classroom link when students join the LINE group, once per
 * burst (a teacher inviting a whole class): the first join after a quiet period
 * gets a reply, which is free. Later joiners get no pushed message (that would
 * use the LINE quota); the teacher can type "พุดดิ้ง เข้าห้อง" to post it again.
 * State lives on the classroom row because each join is its own webhook request.
 */
async function handleMemberJoined(supabase: ServiceClient, groupId: string, replyToken: string | undefined) {
  const { data: classroom } = await supabase.from('classrooms').select('id, name, course_name, subject_code, invite_code').eq('line_group_id', groupId).maybeSingle();
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
  // Mid-burst: just keep the burst going.
  await supabase.from('classrooms').update({ line_member_joined_at: joinedAt }).eq('id', classroom.id);
}
/**
 * The group's "เชื่อมห้องเรียน" button: a link to the teacher's LIFF page with
 * this group preselected. Everyone in the group sees it, but the page only
 * opens for an approved teacher who LINE confirms is in this group; a student
 * who taps it gets a "teachers only" page and nothing is changed.
 */
async function replyConnectButton(supabase: ServiceClient, groupId: string, replyToken: string | undefined, text: string) {
  if (!replyToken) return;
  const group = await ensureBotGroup(supabase, groupId);
  try {
    await replyLineButtons(replyToken, {
      image: connectGuideImage(),
      text,
      actions: [{ type: 'uri', label: '🔗 เชื่อมห้องเรียน', uri: liffConnectUrl(group?.ref) }],
    });
  } catch (error) {
    console.error('LINE connect button reply failed:', error);
    // A reply token works once; it is still unused when LINE rejected the message.
    await replySafely(replyToken, `${text}\n${liffConnectUrl(group?.ref)}`);
  }
}

const CONNECT_BUTTON_TEXT = 'สวัสดีค่ะ 👋 Pudding Bot พร้อมแล้ว\nคุณครูแตะปุ่มด้านล่างเพื่อเลือกห้องเรียนที่จะเชื่อมกับกลุ่มนี้ (สำหรับคุณครูเท่านั้น)';

/**
 * Bot added to a group. LINE does not say who added it, so nothing is linked
 * here: the group is remembered and gets the "เชื่อมห้องเรียน" link button.
 */
async function handleBotJoined(supabase: ServiceClient, groupId: string, replyToken: string | undefined) {
  const summary = await getGroupSummary(groupId).catch(() => null);
  await ensureBotGroup(supabase, groupId, summary?.groupName);
  const linked = await findLinkedClassroom(supabase, groupId);
  if (linked) {
    await replySafely(replyToken, `Pudding เชื่อมต่อแล้ว: ${classroomTitle(linked)}`);
    return;
  }
  await replyConnectButton(supabase, groupId, replyToken, CONNECT_BUTTON_TEXT);
}

/** "พุดดิ้ง เชื่อม" from a teacher: the same link button, whether the group is linked or not. */
async function handleConnectCommand(supabase: ServiceClient, groupId: string, lineUserId: string | undefined, replyToken: string | undefined) {
  const teacher = await findTeacherByLineUid(supabase, lineUserId);
  if (!teacher) return; // students and strangers: no reply
  if (teacher.access !== 'ok') {
    await replySafely(replyToken, teacherAccessMessage(teacher.access));
    return;
  }
  const linked = await findLinkedClassroom(supabase, groupId);
  await replyConnectButton(
    supabase,
    groupId,
    replyToken,
    linked
      ? `กลุ่มนี้เชื่อมกับ “${classroomTitle(linked)}” อยู่\nแตะปุ่มด้านล่างเพื่อย้ายไปห้องอื่นหรือยกเลิกการเชื่อม (สำหรับคุณครู)`
      : 'กลุ่มนี้ยังไม่ได้เชื่อมกับห้องเรียน\nแตะปุ่มด้านล่างเพื่อเลือกห้องเรียน (สำหรับคุณครู)'
  );
}

/** "เชื่อมกลุ่ม" typed (or a rich-menu text button, or the FAQ's "เชื่อมกลุ่ม LINE") in the 1:1 chat. */
const CONNECT_KEYWORDS = new Set(['เชื่อมกลุ่ม', 'เชื่อมกลุ่มline', 'เชื่อมไลน์กลุ่ม', 'เชื่อมline', 'เชื่อมlinegroup', 'เชื่อมต่อกลุ่ม', 'เชื่อมบอท', 'เชื่อมบอทline', 'เชื่อมห้องเรียน', 'connect', 'connectgroup']);
const isConnectKeyword = (text: string) =>
  CONNECT_KEYWORDS.has(text.toLowerCase().replace(/[\s#🔗]/gu, '')) || parseStudentCommand(text) === 'connect';

const MAX_LISTED_CLASSROOMS = 6;

/**
 * The 1:1 chat's welcome (after "add friend") and its answer to "เชื่อมกลุ่ม" /
 * "พุดดิ้ง เชื่อม". Unlike the group card, which everyone in a class sees, this
 * one talks to the person: an approved teacher gets their own classrooms
 * (linked n/m, which ones are still missing) and buttons to act; a teacher
 * waiting for approval, or someone who is not a teacher yet (or a student),
 * gets what to do next. Always: the guide picture, the message, a button card
 * with the FAQ menu as quick replies. All replies, so no message quota.
 */
async function replyPrivateConnect(supabase: ServiceClient, lineUserId: string | undefined, replyToken: string | undefined, mode: 'follow' | 'connect') {
  if (!replyToken) return;
  const faq: LineAction[] = faqMenuButtons().map((label) => ({ type: 'message', label, text: label }));
  const teacher = await findTeacherByLineUid(supabase, lineUserId);

  let text: string;
  let card: { text: string; actions: LineAction[] };
  if (!teacher) {
    text = [
      mode === 'follow' ? 'สวัสดีค่ะ 👋 ยินดีต้อนรับสู่ Pudding 🍮' : 'บัญชี LINE นี้ยังไม่ได้เป็นบัญชีครูใน Pudding',
      '',
      '👩‍🏫 คุณครู: เข้าสู่ระบบเว็บ Pudding ด้วย LINE บัญชีนี้ก่อน (ปุ่มด้านล่าง) แล้วบอทจะจำคุณครูได้ทันที จากนั้นทำตามขั้นตอนฝั่ง “สำหรับคุณครู” ในภาพ',
      '',
      '👩‍🎓 นักเรียน: ไม่ต้องทำอะไรในแชทนี้ แตะ “เข้าร่วมห้องเรียน” ในกลุ่ม LINE ของห้องได้เลย (ฝั่ง “สำหรับนักเรียน” ในภาพ)',
    ].join('\n');
    card = {
      text: 'คุณครูเริ่มต้นที่นี่ 👇',
      actions: [{ type: 'uri', label: '🔑 เข้าสู่ระบบ Pudding', uri: webUrl('/sign-in?openExternalBrowser=1') }],
    };
  } else if (teacher.access !== 'ok') {
    text = [
      `${mode === 'follow' ? 'สวัสดีค่ะ 👋 ' : ''}คุณครู${teacher.first_name || ''}`,
      '',
      teacherAccessMessage(teacher.access),
      '',
      'เมื่อบัญชีพร้อมใช้งาน คุณครูเชื่อมกลุ่ม LINE ได้ตามขั้นตอนในภาพ',
    ].join('\n');
    card = {
      text: 'ตรวจสอบบัญชีครู 👇',
      actions: [{ type: 'uri', label: '👤 ดูสถานะบัญชี', uri: webUrl('/pending-approval?openExternalBrowser=1') }],
    };
  } else {
    const classrooms = await listLinkableClassrooms(supabase, teacher.id);
    const unlinked = classrooms.filter((item) => !item.line_group_id);
    const linkedCount = classrooms.length - unlinked.length;
    const name = teacher.first_name ? `คุณครู${teacher.first_name}` : 'คุณครู';
    const lines = [mode === 'follow' ? `✅ สวัสดีค่ะ ${name} บัญชี LINE นี้เชื่อมกับ Pudding แล้ว` : `🔗 เชื่อมกลุ่ม LINE · ${name}`, ''];
    if (!classrooms.length) {
      lines.push('ยังไม่มีห้องเรียน เริ่มจากสร้างรายวิชาและห้องเรียนบนเว็บก่อนนะคะ (ปุ่ม “สร้างห้องเรียน” ด้านล่าง)');
    } else {
      lines.push(`📊 เชื่อมกลุ่มแล้ว ${linkedCount}/${classrooms.length} ห้อง`);
      if (unlinked.length) {
        lines.push('', 'ห้องที่ยังไม่ได้เชื่อม:');
        lines.push(...unlinked.slice(0, MAX_LISTED_CLASSROOMS).map((item) => `• ${classroomTitle(item)}`));
        if (unlinked.length > MAX_LISTED_CLASSROOMS) lines.push(`• และอีก ${unlinked.length - MAX_LISTED_CLASSROOMS} ห้อง`);
      } else {
        lines.push('เชื่อมครบทุกห้องแล้ว 🎉');
      }
    }
    if (!classrooms.length || unlinked.length) {
      lines.push(
        '',
        'วิธีเชื่อม (ดูภาพด้านบน)',
        '1️⃣ เปิดกลุ่ม LINE ของห้อง → ☰ → เชิญ → Pudding Bot',
        '2️⃣ แตะ “เชื่อมห้องเรียน” ในข้อความของบอทในกลุ่ม',
        '3️⃣ เลือกกลุ่มและห้องเรียน แล้วกด “เชื่อมกลุ่มกับห้องเรียนนี้”',
        '',
        '💡 บอทอยู่ในกลุ่มแล้ว? แตะ “เปิดหน้าเชื่อมกลุ่ม” ด้านล่างได้เลย'
      );
    } else {
      lines.push('', 'ย้ายกลุ่มไปห้องใหม่ หรือยกเลิกการเชื่อม ทำได้ที่ “เปิดหน้าเชื่อมกลุ่ม” ด้านล่าง');
    }
    text = lines.join('\n');
    const connectPage: LineAction = { type: 'uri', label: '🔗 เปิดหน้าเชื่อมกลุ่ม', uri: liffConnectUrl() };
    const createClassroom: LineAction = { type: 'uri', label: '➕ สร้างห้องเรียน', uri: webUrl('/classrooms?createClassroom=1&openExternalBrowser=1') };
    const website: LineAction = { type: 'uri', label: '💻 เปิดเว็บ Pudding', uri: webUrl('/dashboard?openExternalBrowser=1') };
    card = {
      text: classrooms.length ? 'จัดการการเชื่อมกลุ่ม 👇' : 'เริ่มจากสร้างห้องเรียน 👇',
      actions: classrooms.length ? [connectPage, createClassroom, website] : [createClassroom, connectPage, website],
    };
  }

  try {
    await replyLineButtons(replyToken, { image: connectGuideImage(), intro: text, text: card.text, actions: card.actions, quickReplies: faq });
  } catch (error) {
    console.error('LINE private connect reply failed:', error);
    // A reply token works once; it is still unused when LINE rejected the message.
    const links = card.actions.map((action) => (action.type === 'uri' ? `${action.label}: ${action.uri}` : '')).filter(Boolean);
    await replySafely(replyToken, [text, '', ...links].join('\n'));
  }
}


/** Teacher or TA of the classroom; students, researchers and strangers are not. */
async function isClassroomStaff(supabase: ServiceClient, classroom: LinkClassroom, lineUserId: string | undefined) {
  if (!lineUserId) return false;
  const teacher = await findTeacherByLineUid(supabase, lineUserId);
  if (!teacher) return false;
  return classroom.teacher_id === teacher.id
    || (classroom.teachers || []).some((t) => t.teacher_id === teacher.id && t.role !== 'researcher');
}

/** "เหลือ 3 ชม." style countdown to a deadline. */
function timeLeft(deadline: number, now: number) {
  const minutes = Math.floor((deadline - now) / 60000);
  if (minutes < 0) return 'เลยกำหนดแล้ว';
  if (minutes < 60) return `เหลือ ${minutes} นาที`;
  if (minutes < 24 * 60) return `เหลือ ${Math.floor(minutes / 60)} ชม.`;
  return `เหลือ ${Math.floor(minutes / (24 * 60))} วัน`;
}

/** 🔴 under a day (or late), 🟡 under three days, 🟢 later or no deadline. */
function urgency(deadline: number | null, now: number) {
  if (deadline === null) return '🟢';
  const hours = (deadline - now) / 3600000;
  return hours < 24 ? '🔴' : hours < 72 ? '🟡' : '🟢';
}

/** Shortest-first list of the classroom's work students can still hand in. */
async function openWork(supabase: ServiceClient, classroomId: string) {
  const { data } = await supabase.from('assignments').select('*').eq('classroom_id', classroomId);
  const now = Date.now();
  return ((data || []) as Assignment[])
    .map((assignment) => ({ assignment, window: getAssignmentWindow(assignment, now) }))
    .filter(({ window }) => window.acceptsSubmissions)
    .sort((a, b) => (a.window.deadline ?? Infinity) - (b.window.deadline ?? Infinity));
}

/**
 * Answers a "พุดดิ้ง …" message in a classroom group with a reply (free, unlike
 * pushed messages). Only the classroom's teachers and TAs get an answer, so
 * students cannot flood the group with bot replies; the whole group still sees
 * it, and every answer links into the student LIFF app.
 */
async function handleStudentCommand(supabase: ServiceClient, groupId: string, lineUserId: string | undefined, command: StudentCommand, replyToken: string | undefined) {
  const liffUrl = getLiffUrl();
  const classroom = await findLinkedClassroom(supabase, groupId);
  if (!classroom) {
    if (!lineUserId || !(await findTeacherByLineUid(supabase, lineUserId))) return;
    await replySafely(replyToken, command === 'help'
      ? 'กลุ่มนี้ยังไม่ได้เชื่อมกับห้องเรียนใน Pudding\nคุณครูพิมพ์ "พุดดิ้ง เชื่อม" เพื่อเลือกห้องเรียนได้เลยค่ะ'
      : 'กลุ่มนี้ยังไม่ได้เชื่อมกับห้องเรียนใน Pudding\nคุณครูพิมพ์ "พุดดิ้ง เชื่อม" เพื่อเลือกห้องเรียน');
    return;
  }
  if (!(await isClassroomStaff(supabase, classroom, lineUserId))) return;
  const title = classroomTitle(classroom);
  const link = (options: Omit<Parameters<typeof withLiffLink>[2], 'classroomId' | 'inviteCode'> = {}) => ({
    classroomId: classroom.id,
    inviteCode: classroom.invite_code,
    ...options,
  });

  if (command === 'help') {
    await replySafely(replyToken, studentHelpText(title));
  } else if (command === 'join') {
    await replyClassroomJoinCode(replyToken, classroom, liffUrl);
  } else if (command === 'home') {
    await replySafely(replyToken, withLiffLink(`🎓 ${title}`, 'เปิดห้องเรียนใน Pudding', link()));
  } else if (command === 'status') {
    await replySafely(replyToken, `🎓 ${title}\n✅ เชื่อมกับ Pudding แล้ว`);
  } else if (command === 'attendance') {
    const { data: sessions } = await supabase
      .from('attendance_sessions')
      .select('title, starts_at, late_until_minutes')
      .eq('classroom_id', classroom.id)
      .eq('status', 'open')
      .lte('starts_at', new Date().toISOString())
      .order('starts_at', { ascending: false })
      .limit(3);
    if (!sessions?.length) {
      await replySafely(replyToken, `⏰ ${title}\nตอนนี้ยังไม่มีคาบเช็กชื่อที่เปิดอยู่ค่ะ`);
      return;
    }
    const lines = sessions.map((session) => {
      const closesAt = new Date(new Date(session.starts_at).getTime() + (session.late_until_minutes || 30) * 60000).toISOString();
      return `• ${session.title} (เช็กได้ถึง ${formatDateTime(closesAt, 'th', SCHOOL_TIME_ZONE)})`;
    });
    await replySafely(replyToken, withLiffLink(`⏰ เช็กชื่อ\n📘 ${title}\n\n${lines.join('\n')}`, 'กดเพื่อเช็กชื่อ', link({ view: 'attendance' })));
  } else {
    const open = await openWork(supabase, classroom.id);
    if (!open.length) {
      await replySafely(replyToken, withLiffLink(`🎉 ${title}\nตอนนี้ไม่มีงานหรือข้อสอบที่เปิดรับอยู่ค่ะ`, 'ดูงานทั้งหมด', link({ view: 'work' })));
      return;
    }
    const now = Date.now();
    if (command === 'submit') {
      // ส่งงาน: one tappable link per item, most urgent first.
      const shown = open.slice(0, 6);
      const items = shown.map(({ assignment, window }, index) => {
        const action = assignment.is_exam ? '📝 ทำข้อสอบ' : '📤 ส่งงาน';
        const due = window.deadline
          ? `⏳ ${timeLeft(window.deadline, now)} (${formatDateTime(new Date(window.deadline).toISOString(), 'th', SCHOOL_TIME_ZONE)})`
          : '⏳ ไม่มีกำหนดส่ง';
        const late = window.isPastDeadline
          ? `\n⚠️ ส่งตอนนี้จะนับว่าส่งช้า${window.lateUntil ? ` • ปิดรับ ${formatDateTime(new Date(window.lateUntil).toISOString(), 'th', SCHOOL_TIME_ZONE)}` : ''}`
          : '';
        const url = buildLiffUrl(link({ assignmentId: assignment.id }));
        return `【${index + 1}】${assignment.title}\n${due}${late}${url ? `\n${action}【${index + 1}】 👉 ${url}` : ''}`;
      });
      const more = open.length > shown.length ? `\n\n…และอีก ${open.length - shown.length} รายการ ดูได้ในแอป` : '';
      await replySafely(replyToken, `📤 ส่งงาน\n📘 ${title}\nแตะปุ่มด้านล่างตามหมายเลขงาน เพื่อเปิดหน้าส่งงานได้ทันที\n━━━━━━━━━━\n\n${items.join('\n\n')}${more}`);
      return;
    }
    // งาน: a compact overview split into exams and homework, one link at the end.
    const line = ({ assignment, window }: (typeof open)[number]) => {
      const due = window.deadline
        ? ` — ${timeLeft(window.deadline, now)}${window.isPastDeadline ? ' (ส่งช้าได้)' : ''}`
        : '';
      return `${urgency(window.deadline, now)} ${assignment.title}${due}`;
    };
    const exams = open.filter(({ assignment }) => assignment.is_exam);
    const homework = open.filter(({ assignment }) => !assignment.is_exam);
    const sections = [
      exams.length ? `📝 ข้อสอบ (${exams.length})\n${exams.slice(0, 8).map(line).join('\n')}` : '',
      homework.length ? `📋 การบ้าน (${homework.length})\n${homework.slice(0, 8).map(line).join('\n')}` : '',
    ].filter(Boolean);
    await replySafely(replyToken, withLiffLink(
      `📚 งานที่เปิดรับ\n📘 ${title}\nทั้งหมด ${open.length} รายการ\n\n${sections.join('\n\n')}\n\n🔴 ไม่ถึง 1 วัน  🟡 ไม่ถึง 3 วัน  🟢 มากกว่านั้น\n💡 พิมพ์ "พุดดิ้ง ส่งงาน" เพื่อรับปุ่มส่งของแต่ละงาน`,
      'ดูงานทั้งหมด',
      link({ view: 'work' })
    ));
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
    // Only answer 1:1 chats here: in a group the sender may be a student.
    for (const event of (payload.events || []).filter((item) => item.source?.type === 'user')) {
      await replySafely(event.replyToken, error instanceof Error && error.message.includes('SUPABASE_SERVICE_ROLE_KEY')
        ? 'ระบบยังไม่ได้ตั้งค่า SUPABASE_SERVICE_ROLE_KEY บนระบบที่ deploy'
        : 'ระบบยังไม่ได้ตั้งค่า Supabase URL บนระบบที่ deploy');
    }
    return NextResponse.json({ error: 'Supabase service configuration is missing' }, { status: 503 });
  }
  for (const event of payload.events || []) {
    // Multi-person chats ("room") are not classroom groups and may include students.
    if (event.source?.type === 'room') continue;
    const groupId = event.source?.type === 'group' ? event.source.groupId : undefined;
    const lineUserId = event.source?.userId;

    // Bot added to a group: offer the waiting teacher a confirm button.
    if (groupId && event.type === 'join') {
      await handleBotJoined(supabase, groupId, event.replyToken);
      continue;
    }
    // Taps on buttons from older bot messages (confirm / classroom list): answer with the link button.
    if (groupId && event.type === 'postback') {
      if (new URLSearchParams(event.postback?.data || '').has('pudding')) await handleConnectCommand(supabase, groupId, lineUserId, event.replyToken);
      continue;
    }
    // Bot removed from (or left) a group: unlink that classroom in the UI.
    if (groupId && event.type === 'leave') {
      const { data: unlinked, error } = await supabase.from('classrooms').update({
        line_group_id: null,
        line_group_name: null,
        line_connection_status: 'disconnected',
        line_connection_token_expires_at: null,
        line_connected_at: null,
      }).eq('line_group_id', groupId).select('id');
      if (error) console.error('LINE classroom auto-unlink failed:', error);
      signalLineStatus(...(unlinked || []).map((row) => row.id));
      await forgetBotGroup(supabase, groupId);
      continue;
    }
    // Teacher adds / blocks the bot in their 1:1 chat.
    if (!groupId && lineUserId && (event.type === 'follow' || event.type === 'unfollow')) {
      await supabase
        .from('users')
        .update({ line_bot_friend: event.type === 'follow' })
        .eq('teacher_line_uid', lineUserId)
        .eq('role', 'teacher');
      // Follows the LINE OA greeting: the guide picture and where this teacher is.
      if (event.type === 'follow') await replyPrivateConnect(supabase, lineUserId, event.replyToken, 'follow');
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
    if (!groupId && !lineUserId) continue;

    const studentCommand = groupId && event.type === 'message' ? parseStudentCommand(normalizedText) : null;

    // "พุดดิ้ง เชื่อม": the link button to the teacher's connect page.
    if (groupId && studentCommand === 'connect') {
      await handleConnectCommand(supabase, groupId, lineUserId, event.replyToken);
      continue;
    }

    // Group chat: only a teacher's or TA's "พุดดิ้ง" / "pudding" message gets a (free) reply.
    if (groupId) {
      if (studentCommand) await handleStudentCommand(supabase, groupId, lineUserId, studentCommand, event.replyToken);
      continue;
    }

    // 1:1 chat: "เชื่อมกลุ่ม" (typed, or a rich-menu text button) opens the connect page.
    if (event.type === 'message' && isConnectKeyword(normalizedText)) {
      await replyPrivateConnect(supabase, lineUserId, event.replyToken, 'connect');
      continue;
    }

    // 1:1 chat: everyday questions get an answer from the FAQ.
    if (event.type === 'message' && !commandMatch) {
      // Unrecognized messages get no reply, so they can be answered manually.
      const reply = event.message?.type === 'text' ? answerTeacherQuestion(normalizedText) : null;
      if (reply) await replyBotSafely(event.replyToken, reply);
      continue;
    }
    if (!commandMatch) continue;
    const rawCommand = (commandMatch[1] || '').trim();
    const [command, ...args] = rawCommand.split(/\s+/);
    const normalizedCommand = normalizeCommand(command);
    const liffUrl = getLiffUrl();

    const { data: linkedTeacher } = lineUserId
      ? await supabase.from('users').select('id, first_name, last_name, institution, role, teacher_approval').eq('teacher_line_uid', lineUserId).eq('role', 'teacher').maybeSingle()
      : { data: null };

    {
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
      // Same gate as the web app: profile complete and approved by the admin.
      const teacherAccess = teacherAccessOf(linkedTeacher);
      if (teacherAccess !== 'ok') {
        await replySafely(event.replyToken, teacherAccessMessage(teacherAccess));
        continue;
      }
      const { data: allTeacherClasses } = await supabase.from('classrooms').select('id, name, course_name, subject_code, teacher_id, teachers, line_group_id, line_connection_status');
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
          // Shares the web button's quota: a group push is billed per member.
          const reservation = await reserveLineTestSend(supabase, { teacherId: linkedTeacher.id, classroomId: target.id, source: 'line' });
          if (!reservation.ok) {
            await replySafely(event.replyToken, reservation.message);
            continue;
          }
          try {
            await pushLineGroupText(target.line_group_id, `✅ ทดสอบแจ้งเตือนจาก Pudding: ${classroomTitle(target)}`);
            await replySafely(event.replyToken, `ส่งข้อความทดสอบแล้ว (ห้องนี้ทดสอบได้อีก ${reservation.quota.remaining} ครั้งใน ${reservation.quota.windowDays} วัน)`);
          } catch (error) {
            await releaseLineTestSend(supabase, reservation.id);
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

  }
  return NextResponse.json({ ok: true });
}
