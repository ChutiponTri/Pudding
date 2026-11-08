import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import {
  getGroupMemberName,
  getGroupSummary,
  isLineQuotaError,
  pushLineMessages,
  replyLineButtons,
  replyLineMessages,
  replyLineText,
  replyLineTextWithQuickReplies,
  type LineAction,
} from '@/lib/line/messaging';
import {
  connectGuideImage,
  ensureBotGroup,
  findLinkedClassroom,
  findRemovedGroupClassroom,
  findTeacherByLineUid,
  forgetBotGroup,
  relinkRemovedGroup,
  unlinkRemovedGroup,
  liffConnectUrl,
  listLinkableClassrooms,
  webUrl,
  type LinkClassroom,
  type RemovedClassroom,
  type ServiceClient,
} from '@/lib/line/groupLink';
import {
  firstConnCard,
  inviteCard,
  menuCard,
  reconnectedCard,
  removedCard,
  welcomeCard,
  type FlexMessage,
} from '@/lib/line/flex';
import { markWorkCardPosted } from '@/lib/line/workCard';
import { attendanceMessages, guideMessages, inviteMessages, openClassMessages, openWorkMessages, remindReply, resultsMessages, submitMessages, workMessages } from '@/lib/line/teacherCards';
import { parseCardTrigger, type CardTrigger } from '@/lib/line/cardTrigger';
import { buildLiffUrl, withLiffLink } from '@/lib/line/liffLink';
import { answerTeacherQuestion, faqMenuButtons, type BotReply } from '@/lib/line/teacherFaq';
import { parseStudentCommand, studentHelpText, type StudentCommand } from '@/lib/line/studentCommands';
import { getAssignmentWindow } from '@/lib/utils/assignmentWindow';
import { lineDate, SCHOOL_TIME_ZONE } from '@/lib/utils/datetime';
import { classroomTitle, subjectName, type LabelledClassroom } from '@/lib/utils/classroomLabel';
import type { Assignment } from '@/types/database';
import { sendLineTestMessage, testSentText } from '@/lib/server/lineTestSend';
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

/**
 * Reply with Flex cards; when LINE refuses them (a 400 names the bad part),
 * the reply token is still unused, so the plain-text fallback goes out instead.
 */
async function replyCards(replyToken: string | undefined, cards: FlexMessage[], fallback: () => Promise<void>) {
  if (!replyToken) return;
  try {
    await replyLineMessages(replyToken, cards);
  } catch (error) {
    console.error('LINE card reply failed:', error);
    await fallback();
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

/** The "เข้าร่วมห้องเรียน" card (join code + button); plain text when there is no join link. */
async function replyClassroomJoinCode(replyToken: string | undefined, classroom: LabelledClassroom & { invite_code?: string | null; id: string }, liffUrl: string | null) {
  const text = classroomJoinText(classroom, liffUrl);
  const joinUrl = classroomJoinUrl(classroom, liffUrl);
  if (!replyToken || !joinUrl) return replySafely(replyToken, text);
  await replyCards(replyToken, [inviteCard({ classroomTitle: classroomTitle(classroom), inviteCode: classroom.invite_code, url: joinUrl })], () => replySafely(replyToken, text));
}

/** The "เปิดห้องเรียน" card: the classroom in the student LIFF app ("พุดดิ้ง หน้าหลัก"). */
async function replyOpenClass(supabase: ServiceClient, replyToken: string | undefined, classroom: LinkClassroom) {
  if (!replyToken) return;
  const fallback = () => replySafely(replyToken, withLiffLink(`🏫 ${classroomTitle(classroom)}`, 'เปิดห้องเรียนใน Pudding', { classroomId: classroom.id, inviteCode: classroom.invite_code }));
  const cards = await openClassMessages(supabase, classroom);
  if (!cards) return fallback();
  await replyCards(replyToken, cards, fallback);
}

/** Joins closer together than this count as one burst (a teacher inviting a class). */
const JOIN_QUIET_MS = 8000;

/**
 * The welcome card for new students (a free reply): their LINE name when one
 * person joined, the classroom, how many works are open, and the join button.
 */
async function replyWelcome(
  supabase: ServiceClient,
  groupId: string,
  classroom: LabelledClassroom & { id: string; invite_code?: string | null },
  memberIds: string[],
  replyToken: string | undefined
) {
  if (!replyToken) return;
  const liffUrl = getLiffUrl();
  const url = classroomJoinUrl(classroom, liffUrl) || buildLiffUrl({ classroomId: classroom.id, inviteCode: classroom.invite_code });
  if (!url) return replyClassroomJoinCode(replyToken, classroom, liffUrl);
  const [name, open] = await Promise.all([
    memberIds.length === 1 ? getGroupMemberName(groupId, memberIds[0]) : Promise.resolve(null),
    openWork(supabase, classroom.id).then((list) => list.length, () => 0),
  ]);
  const card = welcomeCard({ name, classroomTitle: classroomTitle(classroom), subject: subjectName(classroom), openWork: open, url });
  await replyCards(replyToken, [card], () => replyClassroomJoinCode(replyToken, classroom, liffUrl));
}

/**
 * Welcomes students who join the LINE group with a card, once per burst (a
 * teacher inviting a whole class): the first join after a quiet period gets a
 * reply, which is free. Later joiners get no pushed message (that would use the
 * LINE quota); the teacher can tap "แนะนำนักเรียน" in the menu to post it again.
 * State lives on the classroom row because each join is its own webhook request.
 */
async function handleMemberJoined(supabase: ServiceClient, groupId: string, memberIds: string[], replyToken: string | undefined) {
  const { data: classroom } = await supabase.from('classrooms').select('id, name, course_name, subject_code, invite_code').eq('line_group_id', groupId).maybeSingle();
  if (!classroom) return;
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
    await replyWelcome(supabase, groupId, classroom, memberIds, replyToken);
    return;
  }
  if (first?.length) {
    await replyWelcome(supabase, groupId, classroom, memberIds, replyToken);
    return;
  }
  // Mid-burst: just keep the burst going.
  await supabase.from('classrooms').update({ line_member_joined_at: joinedAt }).eq('id', classroom.id);
}

/**
 * The group's "สำหรับครู" card: its button opens the teacher's LIFF page with
 * this group preselected. Everyone in the group sees it, but the page only
 * opens for an approved teacher who LINE confirms is in this group; a student
 * who taps it gets a "teachers only" page and nothing is changed.
 * `withMenu` puts the teacher menu card first (the bot's first reply in a group);
 * `card: false` (a linked group, where the card's "set up" wording is wrong)
 * sends the plain button instead.
 */
async function replyConnectButton(
  supabase: ServiceClient,
  groupId: string,
  replyToken: string | undefined,
  text: string,
  options: { withMenu?: boolean; card?: boolean; groupName?: string | null; previousRef?: string | null } = {}
) {
  if (!replyToken) return;
  const group = await ensureBotGroup(supabase, groupId, options.groupName, options.previousRef);
  if (!group) {
    // No ref to put in the link (the page only works for one group): ask to try again.
    await replySafely(replyToken, 'ขออภัยค่ะ ระบบขัดข้อง พิมพ์ “พุดดิ้ง เชื่อม” ในกลุ่มนี้อีกครั้ง');
    return;
  }
  const url = liffConnectUrl(group.ref);
  const cards = options.card === false ? [] : options.withMenu ? [menuCard(group.ref), firstConnCard(url)] : [firstConnCard(url)];
  const plain = async () => {
    try {
      await replyLineButtons(replyToken, {
        image: connectGuideImage(),
        text,
        actions: [{ type: 'uri', label: '🔗 เชื่อมห้องเรียน', uri: url }],
      });
    } catch (error) {
      console.error('LINE connect button reply failed:', error);
      await replySafely(replyToken, `${text}\n${url}`);
    }
  };
  if (!cards.length) return plain();
  await replyCards(replyToken, cards, plain);
}

const CONNECT_BUTTON_TEXT = 'สวัสดีค่ะ 👋 Pudding Bot พร้อมแล้ว\nคุณครูแตะปุ่มด้านล่างเพื่อเลือกห้องเรียนที่จะเชื่อมกับกลุ่มนี้ (สำหรับคุณครูเท่านั้น)';

/**
 * Bot added to a group. LINE does not say who added it, so nothing new is
 * linked here. A group the bot was removed from links back to its classroom
 * by itself ("เชื่อมต่อกลับแล้ว!", keeping the group's old ref so pinned menu
 * buttons still work); any other group gets the teacher menu and the
 * "สำหรับครู" connect card. All replies, so no message quota.
 */
async function handleBotJoined(supabase: ServiceClient, groupId: string, replyToken: string | undefined) {
  const [summary, linked, removed] = await Promise.all([
    getGroupSummary(groupId).catch(() => null),
    findLinkedClassroom(supabase, groupId),
    findRemovedGroupClassroom(supabase, groupId),
  ]);
  const groupName = summary?.groupName || removed?.line_group_name || null;
  if (linked) {
    await ensureBotGroup(supabase, groupId, groupName);
    await replyCards(replyToken, [reconnectedCard(classroomTitle(linked))], () => replySafely(replyToken, `Pudding เชื่อมต่อแล้ว: ${classroomTitle(linked)}`));
    return;
  }
  if (removed) {
    const group = await ensureBotGroup(supabase, groupId, groupName, removed.ref);
    if (group && (await relinkRemovedGroup(supabase, removed.id, groupId, groupName))) {
      const title = classroomTitle(removed);
      await replyCards(replyToken, [reconnectedCard(title)], () => replySafely(replyToken, `✅ เชื่อมต่อกลับแล้ว: ${title}`));
      return;
    }
  }
  await replyConnectButton(supabase, groupId, replyToken, CONNECT_BUTTON_TEXT, { withMenu: true, groupName, previousRef: removed?.ref });
}

/**
 * Bot removed from (or left) a group: unlink its classroom (remembering the
 * group so adding the bot back reconnects it), and tell the classroom's
 * teachers in their 1:1 chat. LINE gives no reply token here, so that is a
 * push (one message per teacher): sent once, never retried (a used-up monthly
 * quota is only logged).
 */
async function handleBotRemoved(supabase: ServiceClient, groupId: string) {
  const classrooms = await unlinkRemovedGroup(supabase, groupId);
  await forgetBotGroup(supabase, groupId);
  if (!classrooms.length) return;
  await Promise.all(classrooms.map((classroom) => notifyRemoved(supabase, classroom)));
}

async function notifyRemoved(supabase: ServiceClient, classroom: RemovedClassroom) {
  // The owner and co-teachers (not TAs or researchers), who can link it again.
  const ids = [classroom.teacher_id, ...(classroom.teachers || []).filter((t) => t.role === 'primary' || !t.role).map((t) => t.teacher_id)]
    .filter((id): id is string => !!id);
  if (!ids.length) return;
  const { data: teachers } = await supabase
    .from('users')
    .select('id, teacher_line_uid, line_bot_friend')
    .in('id', [...new Set(ids)])
    .eq('role', 'teacher');
  const card = removedCard(classroomTitle(classroom), classroom.groupName);
  const recipients = [...new Set((teachers || []).filter((t) => t.teacher_line_uid && t.line_bot_friend !== false).map((t) => t.teacher_line_uid as string))];
  await Promise.all(
    recipients.map(async (to) => {
      try {
        await pushLineMessages(to, [card]);
      } catch (error) {
        console.error(isLineQuotaError(error) ? 'LINE removed notice skipped (monthly quota used up):' : 'LINE removed notice failed:', error);
      }
    })
  );
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
      ? `กลุ่มนี้เชื่อมกับ “${classroomTitle(linked)}” อยู่\nแตะปุ่มด้านล่างเพื่อยกเลิกการเชื่อม (สำหรับคุณครู)`
      : 'กลุ่มนี้ยังไม่ได้เชื่อมกับห้องเรียน\nแตะปุ่มด้านล่างเพื่อเลือกห้องเรียน (สำหรับคุณครู)',
    { card: !linked }
  );
}

/**
 * `#pudding test [classroom]` in the teacher's 1:1 chat: the same checks and
 * words as the web's "ทดสอบส่งข้อความ" (sendLineTestMessage). With several
 * linked classrooms and none named, the teacher taps one (quick replies).
 */
async function handleTestCommand(supabase: ServiceClient, teacherId: string, classrooms: LinkClassroom[], args: string[], replyToken: string | undefined) {
  if (!replyToken) return;
  const linked = classrooms.filter((item) => item.line_group_id);
  const query = args.join(' ').trim();
  const target = query
    ? classrooms.find((item) => item.id === query || item.name === query || classroomTitle(item) === query)
    : linked.length === 1 ? linked[0] : undefined;

  if (!target) {
    if (!linked.length) {
      await replySafely(replyToken, `⚠️ ยังไม่มีห้องเรียนที่เชื่อมกลุ่ม LINE\nเชื่อมกลุ่มก่อน แล้วค่อยทดสอบส่งข้อความ\nเชิญ Pudding Bot เข้ากลุ่ม LINE ของห้องเรียน แล้วแตะปุ่ม “เชื่อมห้องเรียน” ในกลุ่ม`);
      return;
    }
    const choices = linked.slice(0, 12);
    try {
      await replyLineButtons(replyToken, {
        text: `🧪 ทดสอบส่งข้อความ\n${query ? `⚠️ ไม่พบห้อง “${query}”\n` : ''}เลือกห้องที่จะทดสอบส่งข้อความเข้ากลุ่ม LINE 👇${linked.length > choices.length ? `\n(แสดง ${choices.length} จาก ${linked.length} ห้อง)` : ''}`,
        actions: choices.map((item) => ({ type: 'message', label: classroomTitle(item), text: `#pudding test ${item.id}` })),
      });
    } catch (error) {
      console.error('LINE test picker reply failed:', error);
    }
    return;
  }

  const result = await sendLineTestMessage(supabase, { teacherId, classroom: target, source: 'line' });
  if (result.ok) {
    await replySafely(replyToken, `${testSentText(result)}\n📘 ${classroomTitle(target)}`);
    return;
  }
  const lines = [`${result.tone === 'warn' ? '⚠️' : '❌'} ${result.message}`, `📘 ${classroomTitle(target)}`];
  // Not (or no longer) linked: offer the way back.
  if (result.code === 'no_group' || result.unlinked) lines.push('เชิญ Pudding Bot เข้ากลุ่ม LINE ของห้อง แล้วแตะปุ่ม “เชื่อมห้องเรียน” ในกลุ่ม');
  await replySafely(replyToken, lines.join('\n'));
}

/** "เชื่อมกลุ่ม" typed (or the FAQ's "เชื่อมกลุ่ม LINE") in the 1:1 chat. */
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
        '3️⃣ เลือกห้องเรียน แล้วกด “เชื่อมกลุ่มกับห้องเรียนนี้”',
        '',
        '💡 บอทอยู่ในกลุ่มแล้ว? เลือกกลุ่มที่ยังไม่ได้เชื่อมในหน้าห้องเรียนบนเว็บได้เช่นกัน'
      );
    } else {
      lines.push('', 'ยกเลิกการเชื่อมได้ในหน้าห้องเรียนบนเว็บ');
    }
    text = lines.join('\n');
    const connectPage: LineAction = { type: 'uri', label: '🔗 เชื่อมกลุ่มบนเว็บ', uri: webUrl('/classrooms?openExternalBrowser=1') };
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
    await replyOpenClass(supabase, replyToken, classroom);
  } else if (command === 'status') {
    const [students, open] = await Promise.all([
      supabase.from('classroom_students').select('id', { count: 'exact', head: true }).eq('classroom_id', classroom.id).eq('status', 'active'),
      openWork(supabase, classroom.id),
    ]);
    const lines = [`🎓 ${title}`, '✅ เชื่อมกับ Pudding แล้ว'];
    if (students.count != null) lines.push(`👥 นักเรียนในห้อง ${students.count} คน`);
    lines.push(`📚 งาน/ข้อสอบที่เปิดรับ ${open.length} รายการ`);
    await replySafely(replyToken, withLiffLink(lines.join('\n'), 'เปิดห้องเรียนใน Pudding', link()));
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
      const closesAt = new Date(new Date(session.starts_at).getTime() + (session.late_until_minutes || 30) * 60000);
      return `• ${session.title} (เช็กได้ถึง ${closesAt.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: SCHOOL_TIME_ZONE })} น.)`;
    });
    await replySafely(replyToken, withLiffLink(`⏰ เช็กชื่อ\n📘 ${title}\n\n${lines.join('\n')}\n\n📷 สแกน QR บนหน้าจอของคุณครูเพื่อเช็กชื่อ`, 'เปิดหน้าเช็กชื่อ', link({ view: 'attendance' })));
  } else {
    const open = await openWork(supabase, classroom.id);
    if (!open.length) {
      await replySafely(replyToken, withLiffLink(`🎉 ${title}\nตอนนี้ไม่มีงานหรือข้อสอบที่เปิดรับอยู่ค่ะ`, 'ดูงานทั้งหมด', link({ view: 'work' })));
      return;
    }
    const now = Date.now();
    if (command === 'submit') {
      // ส่งงาน: one "ส่งงาน" card page per work (who has not handed in, and its button);
      // the plain list below stands in if LINE refuses the cards.
      const { data: room } = await supabase.from('classrooms').select('id, name, course_name, subject_code, invite_code, teacher_id, students').eq('id', classroom.id).maybeSingle();
      const cards = room ? await submitMessages(supabase, room, open) : null;
      const shown = open.slice(0, 6);
      const items = shown.map(({ assignment, window }, index) => {
        const action = assignment.is_exam ? '📝 ทำข้อสอบ' : '📤 ส่งงาน';
        const due = window.deadline
          ? `⏳ ${timeLeft(window.deadline, now)} (กำหนดส่ง ${lineDate(window.deadline)})`
          : '⏳ ไม่มีกำหนดส่ง';
        const late = window.isPastDeadline
          ? `\n⚠️ ส่งตอนนี้จะนับว่าส่งช้า${window.lateUntil ? ` • ปิดรับส่งงาน ${lineDate(window.lateUntil)}` : ''}`
          : '';
        const url = buildLiffUrl(link({ assignmentId: assignment.id }));
        return `【${index + 1}】${assignment.title}\n${due}${late}${url ? `\n${action}【${index + 1}】 👉 ${url}` : ''}`;
      });
      const more = open.length > shown.length ? `\n\n…และอีก ${open.length - shown.length} รายการ ดูได้ในแอป` : '';
      const plain = () => replySafely(replyToken, `📤 ส่งงาน\n📘 ${title}\nแตะปุ่มด้านล่างตามหมายเลขงาน เพื่อเปิดหน้าส่งงานได้ทันที\n━━━━━━━━━━\n\n${items.join('\n\n')}${more}`);
      if (cards) await replyCards(replyToken, cards as FlexMessage[], plain);
      else await plain();
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
    // งาน: the "งานที่เปิดรับ" card; the plain overview stands in if LINE refuses it.
    const plain = () => replySafely(replyToken, withLiffLink(
      `📚 งานที่เปิดรับ\n📘 ${title}\nทั้งหมด ${open.length} รายการ\n\n${sections.join('\n\n')}\n\n🔴 ไม่ถึง 1 วัน  🟡 ไม่ถึง 3 วัน  🟢 มากกว่านั้น\n💡 พิมพ์ "พุดดิ้ง ส่งงาน" เพื่อรับปุ่มส่งของแต่ละงาน`,
      'ดูงานทั้งหมด',
      link({ view: 'work' })
    ));
    const cards = openWorkMessages(classroom, open);
    if (cards) await replyCards(replyToken, cards as FlexMessage[], plain);
    else await plain();
  }
}

/**
 * A card request in the class group: the teacher's reminder picture (its
 * address names the work), or a trigger link from an earlier version. The bot
 * answers with the card, a free reply. Only for the group's own classroom,
 * and only when a teacher or TA sent it, so nobody else can make the bot post
 * cards.
 */
async function handleCardTrigger(supabase: ServiceClient, groupId: string, lineUserId: string | undefined, trigger: CardTrigger, replyToken: string | undefined) {
  if (!replyToken) return;
  const classroom = await findLinkedClassroom(supabase, groupId);
  if (!classroom || (trigger.classroomId && trigger.classroomId !== classroom.id)) return;
  const needsWork = trigger.kind === 'work' || trigger.kind === 'remind' || trigger.kind === 'results';
  const [staff, work, session] = await Promise.all([
    isClassroomStaff(supabase, classroom, lineUserId),
    needsWork && trigger.assignmentId
      ? supabase.from('assignments').select('*').eq('id', trigger.assignmentId).eq('classroom_id', classroom.id).maybeSingle<Assignment>().then((r) => r.data)
      : Promise.resolve(null),
    trigger.kind === 'attendance' && trigger.sessionId
      ? supabase
          .from('attendance_sessions')
          .select('id, title, starts_at, on_time_until_minutes, late_until_minutes, status')
          .eq('id', trigger.sessionId)
          .eq('classroom_id', classroom.id)
          .maybeSingle()
          .then((r) => r.data)
      : Promise.resolve(null),
  ]);
  if (!staff || (needsWork && !work) || (trigger.kind === 'attendance' && !session)) return;

  let messages: Array<Record<string, unknown>> | null = null;
  if (trigger.kind === 'remind' && work) {
    // students: the card and the @mentions name who has not handed in.
    const { data: room } = await supabase.from('classrooms').select('id, name, course_name, subject_code, invite_code, teacher_id, students').eq('id', classroom.id).maybeSingle();
    messages = room ? await remindReply(supabase, work, room, groupId) : null;
    if (!messages) {
      await replySafely(replyToken, `🎉 ${work.title}\nนักเรียนส่งครบทุกคนแล้วค่ะ`);
      return;
    }
  } else if (trigger.kind === 'work' && work) messages = await workMessages(supabase, work, classroom);
  else if (trigger.kind === 'results' && work) messages = await resultsMessages(supabase, work, classroom);
  else if (trigger.kind === 'attendance' && session) messages = attendanceMessages(session, classroom);
  else if (trigger.kind === 'invite') messages = inviteMessages(classroom);
  else if (trigger.kind === 'open') messages = await openClassMessages(supabase, classroom);
  else if (trigger.kind === 'guide') messages = await guideMessages(supabase, classroom);
  if (!messages) return;
  try {
    await replyLineMessages(replyToken, messages);
  } catch (error) {
    console.error(`LINE ${trigger.kind} card reply failed:`, error);
    return;
  }
  if (trigger.kind === 'work' && work) await markWorkCardPosted(supabase, classroom.id, work.id);
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

  const payload = JSON.parse(body) as {
    events?: Array<{
      type?: string;
      replyToken?: string;
      source?: { type?: string; groupId?: string; userId?: string };
      message?: { type?: string; text?: string; contentProvider?: { type?: string; originalContentUrl?: string } };
      postback?: { data?: string };
      joined?: { members?: Array<{ type?: string; userId?: string }> };
    }>;
  };
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

    // Bot added to a group: reconnect a group it was removed from, otherwise the menu + connect cards.
    if (groupId && event.type === 'join') {
      await handleBotJoined(supabase, groupId, event.replyToken);
      continue;
    }
    // Taps on buttons from older bot messages (confirm / classroom list): answer with the link button.
    if (groupId && event.type === 'postback') {
      if (new URLSearchParams(event.postback?.data || '').has('pudding')) await handleConnectCommand(supabase, groupId, lineUserId, event.replyToken);
      continue;
    }
    // Bot removed from (or left) a group: unlink that classroom (it reconnects if the bot comes back) and tell its teachers.
    if (groupId && event.type === 'leave') {
      await handleBotRemoved(supabase, groupId);
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
      const memberIds = (event.joined?.members || []).map((member) => member.userId).filter((id): id is string => !!id);
      await handleMemberJoined(supabase, groupId, memberIds, event.replyToken);
      continue;
    }
    const normalizedText = (event.message?.type === 'text'
      ? event.message.text?.replace(/[​-‍﻿]/g, '').replace(/\s+/g, ' ').trim()
      : '') || '';
    const commandMatch = normalizedText.match(/^#pudding(?:\s+(.+))?$/i);
    if (!groupId && !lineUserId) continue;

    const studentCommand = groupId && event.type === 'message' ? parseStudentCommand(normalizedText) : null;

    // The teacher's reminder picture (sent through LIFF, so LINE gives its address), or an older trigger link.
    const sentPicture = event.message?.type === 'image' && event.message.contentProvider?.type === 'external' ? event.message.contentProvider.originalContentUrl || '' : '';
    const trigger = groupId && event.type === 'message' && !studentCommand ? parseCardTrigger(sentPicture || normalizedText) : null;
    if (groupId && trigger) {
      await handleCardTrigger(supabase, groupId, lineUserId, trigger, event.replyToken);
      continue;
    }

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

    // 1:1 chat: "เชื่อมกลุ่ม" (typed) gets the how-to-connect reply.
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
      // Only this teacher's classrooms (owner or co-teacher/TA), not the whole table.
      const teacherClasses = await listLinkableClassrooms(supabase, linkedTeacher.id);
      if (normalizedCommand === 'status') {
        const connected = teacherClasses.filter((item) => item.line_group_id);
        await replySafely(event.replyToken, `เชื่อมต่อแล้ว ${connected.length}/${teacherClasses.length} ห้อง\nแจ้งเตือน: ${connected.length ? 'พร้อมใช้งาน' : 'ยังไม่พร้อม'}`);
      } else if (normalizedCommand === 'test') {
        await handleTestCommand(supabase, linkedTeacher.id, teacherClasses, args, event.replyToken);
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
