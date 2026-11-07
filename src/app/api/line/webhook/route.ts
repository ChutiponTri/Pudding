import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { getGroupSummary, isGroupMember, leaveGroup, pushLineGroupText, replyLineButtons, replyLineConfirm, replyLineText, replyLineTextWithLinkButton, replyLineTextWithQuickReplies, type LineAction } from '@/lib/line/messaging';
import {
  canLinkLine,
  canUnlinkLine,
  cancelConnectRequest,
  claimGroupPrompt,
  createLinkToken,
  findLinkedClassroom,
  findTeacherByLineUid,
  findWaitingClassrooms,
  forgetPendingGroup,
  getClassroom,
  isTeacherOf,
  linkClassroomToGroup,
  linkErrorMessage,
  liffConnectUrl,
  listLinkableClassrooms,
  rememberPendingGroup,
  signalLineStatus,
  unlinkClassroom,
  webUrl,
  type LineTeacher,
  type LinkClassroom,
  type ServiceClient,
} from '@/lib/line/groupLink';
import { buildLiffUrl, withLiffLink } from '@/lib/line/liffLink';
import { answerTeacherQuestion, teacherFollowUpWelcome, type BotReply } from '@/lib/line/teacherFaq';
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
function classroomLabel(classroom: LinkClassroom) {
  const term = classroom.semester && classroom.year_ce
    ? `ภาคเรียน ${classroom.semester}/${classroom.year_ce + 543}`
    : classroom.academic_year || '';
  return [`“${classroomTitle(classroom)}”`, term].filter(Boolean).join(' · ');
}

/** Links the group and says so in the group (a free reply). */
async function linkGroup(
  supabase: ServiceClient,
  groupId: string,
  classroom: LinkClassroom,
  replyToken: string | undefined,
  replacing?: LinkClassroom
) {
  const result = await linkClassroomToGroup(supabase, groupId, classroom, replacing);
  if (!result.ok) {
    await replySafely(replyToken, linkErrorMessage(result.reason));
    return;
  }
  await replySafely(
    replyToken,
    `✅ เชื่อมกลุ่มนี้กับ “${classroomTitle(classroom)}” เรียบร้อยแล้ว${replacing ? ` (ยกเลิกการเชื่อมกับ “${classroomTitle(replacing)}”)` : ''} ระบบพร้อมส่งแจ้งเตือนการบ้าน\n\n${classroomJoinText(classroom, getLiffUrl())}\n\n💡 คุณครู/TA พิมพ์ "พุดดิ้ง" เพื่อดูคำสั่งทั้งหมด (บอทตอบเฉพาะคุณครูและ TA ของห้อง)`
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

const PICK_ACTION: LineAction = { type: 'postback', label: '🔗 เชื่อมห้องเรียน', data: 'pudding=pick', displayText: 'เชื่อมห้องเรียน' };

const JOIN_GREETING = 'สวัสดีค่ะ 👋 คุณครูแตะปุ่มด้านล่างเพื่อเชื่อมกลุ่มนี้กับห้องเรียนใน Pudding';

/** The "เชื่อมห้องเรียน" button. Anyone sees it; only an approved teacher's tap does anything. */
async function replyPickButton(replyToken: string | undefined, text: string) {
  if (!replyToken) return;
  try {
    await replyLineButtons(replyToken, { text, actions: [PICK_ACTION] });
  } catch (error) {
    console.error('LINE pick button reply failed:', error);
    // A reply token works once; it is still unused when LINE rejected the message.
    await replySafely(replyToken, `${text}\n(หรือพิมพ์ "พุดดิ้ง เชื่อม")`);
  }
}

/**
 * Bot added to a group. LINE does not say who added it, so nothing is linked
 * here. The group is remembered (the web and LIFF page can then offer it); a
 * teacher who already asked to connect a classroom and is in the group gets a
 * confirm button, everyone else the "เชื่อมห้องเรียน" button.
 */
async function handleBotJoined(supabase: ServiceClient, groupId: string, replyToken: string | undefined) {
  const linked = await findLinkedClassroom(supabase, groupId);
  if (linked) {
    await replySafely(replyToken, `Pudding เชื่อมต่อแล้ว: ${classroomTitle(linked)}`);
    return;
  }
  const summary = await getGroupSummary(groupId).catch(() => null);
  await rememberPendingGroup(supabase, groupId, summary?.groupName);

  const waiting = await findWaitingClassrooms(supabase);
  const requesterIds = [...new Set(waiting.map((item) => item.line_connection_token as string))];
  const { data: requesters } = requesterIds.length
    ? await supabase.from('users').select('id, teacher_line_uid, first_name, last_name, institution, teacher_approval').in('id', requesterIds).not('teacher_line_uid', 'is', null)
    : { data: [] as Array<{ id: string; teacher_line_uid: string; first_name?: string; last_name?: string; institution?: string; teacher_approval?: string }> };
  const matches: LinkClassroom[] = [];
  for (const requester of (requesters || []).filter((row) => teacherAccessOf(row) === 'ok')) {
    let member = false;
    try {
      member = await isGroupMember(groupId, requester.teacher_line_uid as string);
    } catch (error) {
      console.error('LINE group membership check failed:', error);
    }
    if (member) matches.push(...waiting.filter((item) => item.line_connection_token === requester.id));
  }

  if (matches.length === 1) {
    await promptLink(replyToken, matches[0], `เชื่อมกลุ่มนี้กับห้องเรียน ${classroomLabel(matches[0])}?`);
  } else {
    await replyPickButton(replyToken, JOIN_GREETING);
  }
}

/**
 * A message in a group from someone who may be a teacher. Only an approved
 * teacher's own message counts: it completes their waiting request, or, in a
 * group that is not linked yet, gets the "เชื่อมห้องเรียน" button once.
 * A group already linked to another classroom is never taken silently: its
 * own teacher is asked to confirm the move (e.g. reusing last semester's
 * group), and other teachers' groups are refused.
 *
 * Returns true when the message was used for linking.
 */
async function handleLinkMessage(supabase: ServiceClient, groupId: string, lineUserId: string, replyToken: string | undefined): Promise<boolean> {
  const teacher = await findTeacherByLineUid(supabase, lineUserId);
  if (!teacher || teacher.access !== 'ok') return false;
  const [classroom] = await findWaitingClassrooms(supabase, teacher.id);
  if (!classroom) {
    if (!(await claimGroupPrompt(supabase, groupId))) return false;
    await replyPickButton(replyToken, 'กลุ่มนี้ยังไม่ได้เชื่อมกับห้องเรียน คุณครูแตะปุ่มด้านล่างเพื่อเลือกห้องเรียน');
    return true;
  }

  const linked = await findLinkedClassroom(supabase, groupId);
  if (!linked) {
    await linkGroup(supabase, groupId, classroom, replyToken);
    return true;
  }
  // Ask once per group; later chat while still waiting goes through as normal.
  if (classroom.line_connection_token_hash === groupId) return false;
  await supabase.from('classrooms').update({ line_connection_token_hash: groupId }).eq('id', classroom.id);
  if (canUnlinkLine(linked, teacher.id)) {
    await promptLink(
      replyToken,
      classroom,
      `กลุ่มนี้เชื่อมกับห้อง ${classroomLabel(linked)} อยู่แล้ว\nย้ายกลุ่มนี้มาใช้กับห้อง ${classroomLabel(classroom)} แทนหรือไม่?`,
      linked
    );
  } else {
    await replySafely(replyToken, `กลุ่มนี้เชื่อมกับ “${classroomTitle(linked)}” ของคุณครูท่านอื่นแล้ว จึงเชื่อมกับ “${classroomTitle(classroom)}” ไม่ได้\nกรุณาใช้กลุ่ม LINE อื่น`);
  }
  return true;
}

/** LINE shows at most 13 quick replies; one row per classroom. */
const MAX_PICK_CLASSROOMS = 12;

/**
 * The group's connect menu for an approved teacher ("เชื่อมห้องเรียน" tap or
 * "พุดดิ้ง เชื่อม"). It follows the group's state:
 *   - not linked: their free classrooms to pick, plus "สร้างห้องเรียนใหม่"
 *   - linked to their classroom: move to another classroom / unlink
 *   - linked to another teacher's classroom: refused
 * `move` lists classrooms to move the linked group to.
 */
async function handleGroupConnectMenu(supabase: ServiceClient, groupId: string, teacher: LineTeacher, replyToken: string | undefined, mode: 'menu' | 'move' = 'menu') {
  if (!replyToken) return;
  const linked = await findLinkedClassroom(supabase, groupId);
  if (linked && !isTeacherOf(linked, teacher.id)) {
    await replySafely(replyToken, `กลุ่มนี้เชื่อมกับ “${classroomTitle(linked)}” ของคุณครูท่านอื่นแล้ว`);
    return;
  }
  if (linked && (mode === 'menu' || !canUnlinkLine(linked, teacher.id))) {
    const text = `กลุ่มนี้เชื่อมกับห้อง ${classroomLabel(linked)} แล้ว`;
    if (!canUnlinkLine(linked, teacher.id)) {
      await replySafely(replyToken, `${text}\n(การย้ายหรือยกเลิกการเชื่อม ทำได้โดยคุณครูเจ้าของห้อง)`);
      return;
    }
    try {
      await replyLineButtons(replyToken, {
        text,
        actions: [
          { type: 'postback', label: '🔁 ย้ายไปห้องอื่น', data: new URLSearchParams({ pudding: 'move', classroomId: linked.id }).toString(), displayText: 'ย้ายกลุ่มไปห้องอื่น' },
          { type: 'postback', label: '⛔ ยกเลิกการเชื่อม', data: new URLSearchParams({ pudding: 'unlink-ask', classroomId: linked.id }).toString(), displayText: 'ยกเลิกการเชื่อม' },
        ],
      });
    } catch (error) {
      console.error('LINE linked menu reply failed:', error);
    }
    return;
  }

  const all = await listLinkableClassrooms(supabase, teacher.id, { unlinkedOnly: true });
  const classes = all.slice(0, MAX_PICK_CLASSROOMS);
  const [token, summary] = await Promise.all([
    createLinkToken(supabase, groupId, teacher.id),
    getGroupSummary(groupId).catch(() => null),
  ]);
  const createParams = new URLSearchParams({ createClassroom: '1' });
  if (token) createParams.set('lineLink', token);
  if (summary?.groupName) createParams.set('groupName', summary.groupName);
  // Opens the teacher's own browser, where their Pudding sign-in lives.
  createParams.set('openExternalBrowser', '1');
  const createAction: LineAction = { type: 'uri', label: '➕ สร้างห้องเรียนใหม่', uri: webUrl(`/classrooms?${createParams}`) };

  const heading = linked
    ? `ย้ายกลุ่มนี้จาก “${classroomTitle(linked)}” ไปห้องไหนคะ?`
    : `คุณครู${teacher.first_name || ''} เลือกห้องเรียนที่จะเชื่อมกับกลุ่มนี้`;
  const replace: Record<string, string> = linked ? { replace: linked.id } : {};
  try {
    if (!classes.length) {
      await replyLineButtons(replyToken, {
        text: `${heading}\nยังไม่มีห้องเรียนที่ว่างอยู่ สร้างห้องใหม่แล้วระบบจะเชื่อมกลุ่มนี้ให้ทันที`,
        actions: [createAction],
      });
      return;
    }
    await replyLineButtons(replyToken, {
      intro: [
        heading,
        '',
        ...classes.map((item, index) => `${index + 1}. ${classroomLabel(item)}`),
        all.length > classes.length ? `\n(แสดง ${classes.length} ห้องล่าสุด จากทั้งหมด ${all.length} ห้อง)` : '',
      ].filter((line, index, lines) => line !== '' || index < lines.length - 1).join('\n').trim(),
      text: 'แตะหมายเลขห้องด้านล่าง 👇 หรือสร้างห้องเรียนใหม่สำหรับกลุ่มนี้',
      actions: [createAction],
      quickReplies: classes.map((item, index) => ({
        type: 'postback',
        label: `${index + 1}. ${classroomTitle(item)}`,
        data: new URLSearchParams({ pudding: 'link', classroomId: item.id, ...replace }).toString(),
        displayText: `เชื่อม ${classroomTitle(item)}`,
      })),
    });
  } catch (error) {
    console.error('LINE classroom picker reply failed:', error);
  }
}

/**
 * Taps on the bot's buttons in a group. LINE tells us who tapped: students
 * and strangers are ignored, a teacher who is not approved is told why, and
 * every action re-checks that this teacher may change this classroom.
 */
async function handleLinkPostback(supabase: ServiceClient, groupId: string, lineUserId: string | undefined, data: string, replyToken: string | undefined) {
  const params = new URLSearchParams(data);
  const action = params.get('pudding');
  const teacher = await findTeacherByLineUid(supabase, lineUserId);
  if (!teacher) return;
  if (teacher.access !== 'ok') {
    await replySafely(replyToken, teacherAccessMessage(teacher.access));
    return;
  }
  if (action === 'pick') {
    await handleGroupConnectMenu(supabase, groupId, teacher, replyToken);
    return;
  }
  if (action === 'keep') {
    await replySafely(replyToken, 'ยังเชื่อมกลุ่มนี้ไว้เหมือนเดิมค่ะ');
    return;
  }

  const classroomId = params.get('classroomId');
  const classroom = classroomId ? await getClassroom(supabase, classroomId) : null;
  // Not their classroom (or it is gone): nothing to say in front of the class.
  if (!classroom || !canLinkLine(classroom, teacher.id)) return;

  if (action === 'cancel') {
    if (classroom.line_connection_status !== 'waiting' || classroom.line_connection_token !== teacher.id) return;
    await cancelConnectRequest(supabase, classroom.id);
    signalLineStatus(classroom.id);
    await replySafely(replyToken, `ยกเลิกการเชื่อม “${classroomTitle(classroom)}” แล้ว`);
    return;
  }

  if (action === 'move' || action === 'unlink-ask' || action === 'unlink') {
    if (classroom.line_group_id !== groupId || !canUnlinkLine(classroom, teacher.id)) {
      await replySafely(replyToken, 'สถานะกลุ่มเปลี่ยนไปแล้ว หรือคุณครูไม่มีสิทธิ์เปลี่ยนการเชื่อมของห้องนี้');
      return;
    }
    if (action === 'move') {
      await handleGroupConnectMenu(supabase, groupId, teacher, replyToken, 'move');
    } else if (action === 'unlink-ask') {
      if (!replyToken) return;
      try {
        await replyLineConfirm(
          replyToken,
          `ยกเลิกการเชื่อมกลุ่มนี้กับ “${classroomTitle(classroom)}”?\nบอทจะออกจากกลุ่มและหยุดส่งแจ้งเตือน`,
          { label: 'ยกเลิกการเชื่อม', data: new URLSearchParams({ pudding: 'unlink', classroomId: classroom.id }).toString() },
          { label: 'ไม่ใช่', data: 'pudding=keep' }
        );
      } catch (error) {
        console.error('LINE unlink confirm failed:', error);
      }
    } else {
      const { error } = await unlinkClassroom(supabase, classroom.id);
      if (error) {
        await replySafely(replyToken, 'ยกเลิกการเชื่อมไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
        return;
      }
      await replySafely(replyToken, `ยกเลิกการเชื่อมกับ “${classroomTitle(classroom)}” แล้ว บอทขอตัวออกจากกลุ่มนะคะ 👋\n(เชื่อมใหม่ได้โดยเชิญ Pudding Bot เข้ากลุ่มอีกครั้ง)`);
      // The "leave" webhook that follows finds no linked classroom and does nothing.
      try {
        await leaveGroup(groupId);
      } catch (leaveError) {
        console.warn('LINE bot could not leave the group:', leaveError);
      }
    }
    return;
  }

  if (action !== 'link') return;
  if (classroom.line_group_id) {
    await replySafely(replyToken, classroom.line_group_id === groupId
      ? `กลุ่มนี้เชื่อมกับ “${classroomTitle(classroom)}” อยู่แล้ว`
      : `“${classroomTitle(classroom)}” เชื่อมกับกลุ่ม LINE อื่นอยู่แล้ว (ยกเลิกการเชื่อมกลุ่มเดิมก่อน)`);
    return;
  }
  const linked = await findLinkedClassroom(supabase, groupId);
  const replaceId = params.get('replace');
  if (!linked) {
    await linkGroup(supabase, groupId, classroom, replyToken);
  } else if (linked.id === replaceId && canUnlinkLine(linked, teacher.id)) {
    await linkGroup(supabase, groupId, classroom, replyToken, linked);
  } else if (canUnlinkLine(linked, teacher.id)) {
    await promptLink(
      replyToken,
      classroom,
      `กลุ่มนี้เชื่อมกับห้อง ${classroomLabel(linked)} อยู่แล้ว\nย้ายกลุ่มนี้มาใช้กับห้อง ${classroomLabel(classroom)} แทนหรือไม่?`,
      linked
    );
  } else {
    await replySafely(replyToken, `กลุ่มนี้เชื่อมกับ “${classroomTitle(linked)}” ของคุณครูท่านอื่นแล้ว จึงไม่ได้เปลี่ยนแปลงอะไร`);
  }
}

/** "เชื่อมกลุ่ม" typed (or sent by a rich-menu text button) in the teacher's 1:1 chat. */
const CONNECT_KEYWORDS = new Set(['เชื่อมกลุ่ม', 'เชื่อมไลน์กลุ่ม', 'เชื่อมline', 'เชื่อมlinegroup', 'เชื่อมต่อกลุ่ม', 'เชื่อมบอท', 'เชื่อมบอทline', 'เชื่อมห้องเรียน', 'connect', 'connectgroup']);
const isConnectKeyword = (text: string) => CONNECT_KEYWORDS.has(text.toLowerCase().replace(/[\s#🔗]/gu, ''));

async function handleConnectKeyword(supabase: ServiceClient, lineUserId: string | undefined, replyToken: string | undefined) {
  if (!replyToken) return;
  const teacher = await findTeacherByLineUid(supabase, lineUserId);
  if (!teacher) {
    await replySafely(replyToken, 'บัญชี LINE นี้ยังไม่ได้เชื่อมกับบัญชีครูใน Pudding กรุณาเข้าสู่ระบบเว็บ Pudding ด้วย LINE (บัญชีเดียวกับแชทนี้) ก่อนนะคะ');
    return;
  }
  if (teacher.access !== 'ok') {
    await replySafely(replyToken, teacherAccessMessage(teacher.access));
    return;
  }
  try {
    await replyLineButtons(replyToken, {
      intro: 'เชื่อมกลุ่ม LINE กับห้องเรียนได้ 2 แบบ เลือกแบบที่สะดวกค่ะ\n\n1️⃣ เชิญ Pudding Bot เข้ากลุ่มห้องเรียน แล้วแตะ “เชื่อมห้องเรียน” ในข้อความของบอท\n2️⃣ เปิดหน้าเชื่อมกลุ่ม เลือกห้องเรียน แล้วค่อยเชิญบอทเข้ากลุ่ม (ถ้าบอทอยู่ในกลุ่มแล้ว เลือกกลุ่มได้ทันที)',
      text: 'แตะเพื่อเปิดหน้าเชื่อมกลุ่ม 👇',
      actions: [{ type: 'uri', label: '🔗 เปิดหน้าเชื่อมกลุ่ม', uri: liffConnectUrl() }],
    });
  } catch (error) {
    console.error('LINE connect keyword reply failed:', error);
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
    if (groupId && event.type === 'postback') {
      const data = event.postback?.data || '';
      if (new URLSearchParams(data).has('pudding')) await handleLinkPostback(supabase, groupId, lineUserId, data, event.replyToken);
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
      await forgetPendingGroup(supabase, groupId);
      continue;
    }
    // Teacher adds / blocks the bot in their 1:1 chat.
    if (!groupId && lineUserId && (event.type === 'follow' || event.type === 'unfollow')) {
      const { data: teacher } = await supabase
        .from('users')
        .update({ line_bot_friend: event.type === 'follow' })
        .eq('teacher_line_uid', lineUserId)
        .eq('role', 'teacher')
        .select('first_name')
        .maybeSingle();
      // Follows the LINE OA greeting (its 4 setup steps), picking up where this teacher is.
      if (event.type === 'follow') await replyBotSafely(event.replyToken, teacherFollowUpWelcome(teacher));
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

    // "พุดดิ้ง เชื่อม": the group's connect menu (link, move or unlink), linked or not.
    if (groupId && studentCommand === 'connect') {
      const teacher = await findTeacherByLineUid(supabase, lineUserId);
      if (teacher?.access === 'ok') await handleGroupConnectMenu(supabase, groupId, teacher, event.replyToken);
      else if (teacher) await replySafely(event.replyToken, teacherAccessMessage(teacher.access));
      continue;
    }

    // A teacher's message in the group completes their waiting request, or
    // (group not linked yet) gets the "เชื่อมห้องเรียน" button once.
    if (groupId && lineUserId && event.type === 'message') {
      if (await handleLinkMessage(supabase, groupId, lineUserId, event.replyToken)) continue;
    }

    // Group chat: only a teacher's or TA's "พุดดิ้ง" / "pudding" message gets a (free) reply.
    if (groupId) {
      if (studentCommand) await handleStudentCommand(supabase, groupId, lineUserId, studentCommand, event.replyToken);
      continue;
    }

    // 1:1 chat: "เชื่อมกลุ่ม" (typed, or a rich-menu text button) opens the connect page.
    if (event.type === 'message' && isConnectKeyword(normalizedText)) {
      await handleConnectKeyword(supabase, lineUserId, event.replyToken);
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
