import 'server-only';
import { randomBytes } from 'node:crypto';
import { after } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { getGroupSummary, isGroupMember } from '@/lib/line/messaging';
import { signalClassroom } from '@/lib/realtime/classroomSignal';
import { PUDDING_WEB_URL } from '@/lib/line/teacherFaq';
import { teacherAccessOf, type TeacherAccess } from '@/lib/utils/teacherProfile';

/**
 * Linking a classroom to a LINE group: the teacher picks a group the bot is
 * in and one of their classrooms, on the LIFF page (/liff/connect, opened from
 * the bot's button in the group or the rich menu) or in the web dialog.
 * Nothing waits for a message. Groups the bot is in live in line_bot_groups
 * under an opaque `ref`, so links never carry the LINE group id; LINE itself
 * confirms the teacher is a member before anything is linked.
 */

export type ServiceClient = ReturnType<typeof createServiceSupabaseClient>;

/** Unlinked groups older than this are not offered (the bot may sit there forgotten). */
const UNLINKED_GROUP_MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000;
const MAX_UNLINKED_GROUPS = 20;

export type LinkClassroom = {
  id: string;
  name: string;
  invite_code?: string | null;
  teacher_id?: string | null;
  teachers?: Array<{ teacher_id?: string; role?: string }> | null;
  course_name?: string | null;
  subject_code?: string | null;
  semester?: number | null;
  year_ce?: number | null;
  academic_year?: string | null;
  line_group_id?: string | null;
  line_group_name?: string | null;
  created_at?: string | null;
};

export const LINK_COLUMNS = 'id, name, invite_code, teacher_id, teachers, course_name, subject_code, semester, year_ce, academic_year, line_group_id, line_group_name, created_at';

export const isTeacherOf = (classroom: LinkClassroom, teacherId: string) =>
  classroom.teacher_id === teacherId || (classroom.teachers || []).some((t) => t.teacher_id === teacherId);

/** Owner, co-teacher or TA may link a group; researchers may not. */
export const canLinkLine = (classroom: LinkClassroom, teacherId: string) =>
  classroom.teacher_id === teacherId || (classroom.teachers || []).some((t) => t.teacher_id === teacherId && t.role !== 'researcher');

/** Only the owner or a co-teacher may unlink a group or move it to another classroom. */
export const canUnlinkLine = (classroom: LinkClassroom, teacherId: string) =>
  classroom.teacher_id === teacherId || (classroom.teachers || []).some((t) => t.teacher_id === teacherId && (t.role === 'primary' || !t.role));

export type LineTeacher = { id: string; first_name?: string | null; lineUid: string; access: TeacherAccess };

/** Registered teacher behind a LINE user id, with their approval state (students and strangers return null). */
export async function findTeacherByLineUid(supabase: ServiceClient, lineUserId: string | undefined | null): Promise<LineTeacher | null> {
  if (!lineUserId) return null;
  const { data } = await supabase
    .from('users')
    .select('id, first_name, last_name, institution, teacher_approval')
    .eq('teacher_line_uid', lineUserId)
    .eq('role', 'teacher')
    .maybeSingle();
  if (!data) return null;
  return { id: data.id, first_name: data.first_name, lineUid: lineUserId, access: teacherAccessOf(data) };
}

/** The classroom this LINE group is linked to, if any. */
export async function findLinkedClassroom(supabase: ServiceClient, groupId: string): Promise<LinkClassroom | null> {
  const { data } = await supabase.from('classrooms').select(LINK_COLUMNS).eq('line_group_id', groupId).limit(1);
  return ((data || []) as LinkClassroom[])[0] || null;
}

export async function getClassroom(supabase: ServiceClient, classroomId: string): Promise<LinkClassroom | null> {
  const { data } = await supabase.from('classrooms').select(LINK_COLUMNS).eq('id', classroomId).maybeSingle();
  return (data as LinkClassroom | null) || null;
}

/** Classrooms the teacher may link, newest first. */
export async function listLinkableClassrooms(supabase: ServiceClient, teacherId: string): Promise<LinkClassroom[]> {
  const [owned, shared] = await Promise.all([
    supabase.from('classrooms').select(LINK_COLUMNS).eq('teacher_id', teacherId),
    supabase.from('classrooms').select(LINK_COLUMNS).contains('teachers', JSON.stringify([{ teacher_id: teacherId }])),
  ]);
  const byId = new Map<string, LinkClassroom>();
  for (const row of [...((owned.data || []) as LinkClassroom[]), ...((shared.data || []) as LinkClassroom[])]) byId.set(row.id, row);
  return [...byId.values()]
    .filter((row) => canLinkLine(row, teacherId))
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
}

/** Open teacher pages refresh the classroom's LINE status (no classroom signal is sent otherwise). */
export function signalLineStatus(...classroomIds: Array<string | null | undefined>) {
  after(() => Promise.all(classroomIds.map((id) => signalClassroom(id, { type: 'roster', action: 'updated' }))));
}

// ---------------------------------------------------------------------------
// Groups the bot is in
// ---------------------------------------------------------------------------

export type BotGroup = { groupId: string; ref: string; groupName?: string };

const newRef = () => randomBytes(12).toString('base64url');

/**
 * The bot's record of a group, created if missing (the bot joined before
 * this table existed). Returns null only when the table is missing.
 */
export async function ensureBotGroup(supabase: ServiceClient, groupId: string, groupName?: string | null): Promise<BotGroup | null> {
  const { data: existing } = await supabase.from('line_bot_groups').select('group_id, ref, group_name').eq('group_id', groupId).maybeSingle();
  if (existing) {
    if (groupName && groupName !== existing.group_name) {
      await supabase.from('line_bot_groups').update({ group_name: groupName }).eq('group_id', groupId);
    }
    return { groupId, ref: existing.ref as string, groupName: groupName || (existing.group_name as string | null) || undefined };
  }
  const name = groupName ?? (await getGroupSummary(groupId).catch(() => null))?.groupName ?? null;
  const ref = newRef();
  const { error } = await supabase.from('line_bot_groups').insert({ group_id: groupId, ref, group_name: name });
  if (error) {
    // Lost a race with another webhook: read the winner's row.
    const { data: again } = await supabase.from('line_bot_groups').select('ref, group_name').eq('group_id', groupId).maybeSingle();
    if (again) return { groupId, ref: again.ref as string, groupName: (again.group_name as string | null) || undefined };
    console.warn('LINE bot group save failed (run supabase_line_connect_flow_update.sql):', error.message);
    return null;
  }
  return { groupId, ref, groupName: name || undefined };
}

export async function forgetBotGroup(supabase: ServiceClient, groupId: string) {
  const { error } = await supabase.from('line_bot_groups').delete().eq('group_id', groupId);
  if (error) console.warn('LINE bot group delete failed:', error.message);
}

export async function findBotGroupByRef(supabase: ServiceClient, ref: string | null | undefined): Promise<BotGroup | null> {
  if (!ref) return null;
  const { data } = await supabase.from('line_bot_groups').select('group_id, ref, group_name').eq('ref', ref).maybeSingle();
  return data ? { groupId: data.group_id as string, ref: data.ref as string, groupName: (data.group_name as string | null) || undefined } : null;
}

async function isMember(groupId: string, lineUid: string) {
  try {
    return await isGroupMember(groupId, lineUid);
  } catch (error) {
    console.error('LINE group membership check failed:', error);
    return false;
  }
}

/** A group the teacher may pick: they are in it (LINE says so) and the bot is too. */
export type TeacherGroup = {
  ref: string;
  groupName?: string;
  /** Classroom the group is linked to now, if any (always one of this teacher's). */
  linkedClassroomId?: string;
};

/**
 * Groups this teacher can pick: unlinked groups the bot joined recently that
 * LINE confirms they are a member of, plus the groups already linked to their
 * own classrooms (to move them). `focusRef` (the group whose button was
 * tapped) is always checked, however old.
 */
export async function listTeacherGroups(
  supabase: ServiceClient,
  teacher: { id: string; lineUid: string },
  classrooms: LinkClassroom[],
  focusRef?: string | null
): Promise<{ groups: TeacherGroup[]; focus?: TeacherGroup | { ref: string; error: string } }> {
  const since = new Date(Date.now() - UNLINKED_GROUP_MAX_AGE_MS).toISOString();
  const linkedIds = classrooms.map((item) => item.line_group_id).filter(Boolean) as string[];
  const [recent, own, focusGroup] = await Promise.all([
    supabase.from('line_bot_groups').select('group_id, ref, group_name').gte('joined_at', since).order('joined_at', { ascending: false }).limit(MAX_UNLINKED_GROUPS * 2),
    linkedIds.length ? supabase.from('line_bot_groups').select('group_id, ref, group_name').in('group_id', linkedIds) : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    findBotGroupByRef(supabase, focusRef),
  ]);
  const rows = [...((recent.data || []) as Array<Record<string, unknown>>)];
  if (focusGroup && !rows.some((row) => row.group_id === focusGroup.groupId)) {
    rows.unshift({ group_id: focusGroup.groupId, ref: focusGroup.ref, group_name: focusGroup.groupName || null });
  }
  const ids = rows.map((row) => row.group_id as string);
  const { data: linkedRows } = ids.length
    ? await supabase.from('classrooms').select('id, line_group_id').in('line_group_id', ids)
    : { data: [] as Array<{ id: string; line_group_id: string }> };
  const linkedTo = new Map((linkedRows || []).map((row) => [row.line_group_id as string, row.id as string]));
  const mine = new Map(classrooms.filter((item) => item.line_group_id).map((item) => [item.line_group_id as string, item.id]));

  // Unlinked ones need LINE to confirm membership; ones linked to other teachers are skipped.
  const unlinked = rows.filter((row) => !linkedTo.has(row.group_id as string)).slice(0, MAX_UNLINKED_GROUPS);
  const checks = await Promise.all(unlinked.map((row) => isMember(row.group_id as string, teacher.lineUid)));
  const groups: TeacherGroup[] = unlinked
    .filter((_, index) => checks[index])
    .map((row) => ({ ref: row.ref as string, groupName: (row.group_name as string | null) || undefined }));
  for (const row of (own.data || []) as Array<Record<string, unknown>>) {
    groups.push({ ref: row.ref as string, groupName: (row.group_name as string | null) || undefined, linkedClassroomId: mine.get(row.group_id as string) });
  }

  let focus: TeacherGroup | { ref: string; error: string } | undefined;
  if (focusRef) {
    if (!focusGroup) {
      focus = { ref: focusRef, error: 'ไม่พบกลุ่มนี้ (บอทอาจถูกนำออกจากกลุ่มแล้ว) กรุณาเชิญ Pudding Bot เข้ากลุ่มอีกครั้ง' };
    } else {
      const found = groups.find((group) => group.ref === focusRef);
      if (found) focus = found;
      else if (linkedTo.has(focusGroup.groupId)) focus = { ref: focusRef, error: 'กลุ่มนี้เชื่อมกับห้องเรียนของคุณครูท่านอื่นแล้ว' };
      else focus = { ref: focusRef, error: 'ไม่พบคุณครูในกลุ่มนี้ เปิดปุ่มนี้จากบัญชี LINE ที่อยู่ในกลุ่มและใช้เข้าสู่ระบบ Pudding' };
    }
  }
  return { groups, focus };
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

export type LinkResult =
  | { ok: true; groupName?: string; movedFrom?: LinkClassroom }
  | { ok: false; reason: 'not-found' | 'not-member' | 'group-taken' | 'classroom-taken' | 'changed' | 'not-allowed' | 'failed' };

/**
 * Links the group behind `ref` to `classroom` for this teacher. LINE confirms
 * the teacher is in the group. A group linked to another classroom moves only
 * when `move` is set and the teacher may unlink that classroom; a classroom
 * linked to another group must be unlinked first. The caller has checked the
 * teacher is approved and may link `classroom`.
 */
export async function linkGroupByRef(
  supabase: ServiceClient,
  teacher: { id: string; lineUid: string },
  classroom: LinkClassroom,
  ref: string,
  options: { move?: boolean } = {}
): Promise<LinkResult> {
  const group = await findBotGroupByRef(supabase, ref);
  if (!group) return { ok: false, reason: 'not-found' };
  if (classroom.line_group_id === group.groupId) return { ok: true, groupName: group.groupName };
  if (classroom.line_group_id) return { ok: false, reason: 'classroom-taken' };
  if (!(await isMember(group.groupId, teacher.lineUid))) return { ok: false, reason: 'not-member' };

  const linked = await findLinkedClassroom(supabase, group.groupId);
  if (linked && (!options.move || !canUnlinkLine(linked, teacher.id))) {
    return { ok: false, reason: isTeacherOf(linked, teacher.id) ? 'group-taken' : 'not-allowed' };
  }
  if (linked) {
    const { data: unlinked } = await supabase.from('classrooms').update({
      line_group_id: null,
      line_group_name: null,
      line_connection_status: 'disconnected',
      line_connected_at: null,
    }).eq('id', linked.id).eq('line_group_id', group.groupId).select('id');
    if (!unlinked?.length) return { ok: false, reason: 'changed' };
  }

  // The bot must still be in the group (its summary is only readable from inside).
  const summary = await getGroupSummary(group.groupId).catch(() => null);
  if (!summary) {
    if (linked) {
      await supabase.from('classrooms').update({
        line_group_id: group.groupId,
        line_group_name: linked.line_group_name || null,
        line_connection_status: 'connected',
        line_connected_at: new Date().toISOString(),
      }).eq('id', linked.id).is('line_group_id', null);
    }
    return { ok: false, reason: 'not-found' };
  }
  const groupName = summary.groupName || group.groupName || null;
  const { data: updated, error } = await supabase.from('classrooms').update({
    line_group_id: group.groupId,
    line_group_name: groupName,
    line_connection_status: 'connected',
    line_connection_token_hash: null,
    line_connection_token: null,
    line_connection_token_expires_at: null,
    line_connected_at: new Date().toISOString(),
  }).eq('id', classroom.id).is('line_group_id', null).select('id');
  if (error || !updated?.length) {
    if (error) console.error('LINE classroom link failed:', error);
    if (linked) {
      // Put the old link back rather than leave the group linked to nothing.
      await supabase.from('classrooms').update({
        line_group_id: group.groupId,
        line_group_name: groupName,
        line_connection_status: 'connected',
        line_connected_at: new Date().toISOString(),
      }).eq('id', linked.id).is('line_group_id', null);
    }
    return { ok: false, reason: error ? 'failed' : 'classroom-taken' };
  }
  if (groupName && groupName !== group.groupName) {
    await supabase.from('line_bot_groups').update({ group_name: groupName }).eq('group_id', group.groupId);
  }
  signalLineStatus(classroom.id, linked?.id);
  return { ok: true, groupName: groupName || undefined, movedFrom: linked || undefined };
}

/** Unlinks the classroom's group in the database; the caller makes the bot leave. */
export async function unlinkClassroom(supabase: ServiceClient, classroomId: string) {
  const { error } = await supabase.from('classrooms').update({
    line_group_id: null,
    line_group_name: null,
    line_connection_status: 'disconnected',
    line_connection_token_hash: null,
    line_connection_token: null,
    line_connection_token_expires_at: null,
    line_connected_at: null,
  }).eq('id', classroomId);
  if (!error) signalLineStatus(classroomId);
  return { error };
}

export function linkErrorMessage(reason: string) {
  switch (reason) {
    case 'not-found': return 'ไม่พบกลุ่มนี้ หรือบอทไม่ได้อยู่ในกลุ่มแล้ว กรุณาเชิญ Pudding Bot เข้ากลุ่มอีกครั้ง';
    case 'not-member': return 'ไม่พบคุณครูในกลุ่มนี้ (ต้องเป็นบัญชี LINE เดียวกับที่ใช้เข้าสู่ระบบ Pudding)';
    case 'group-taken': return 'กลุ่มนี้เชื่อมกับห้องเรียนอื่นของคุณครูอยู่ เลือก “ย้ายมาห้องนี้” หากต้องการย้าย';
    case 'not-allowed': return 'กลุ่มนี้เชื่อมกับห้องเรียนที่คุณครูไม่มีสิทธิ์เปลี่ยน';
    case 'classroom-taken': return 'ห้องเรียนนี้เชื่อมกับกลุ่ม LINE อื่นอยู่แล้ว ยกเลิกการเชื่อมกลุ่มเดิมก่อน';
    case 'changed': return 'สถานะกลุ่มเปลี่ยนไปแล้ว กรุณาลองใหม่อีกครั้ง';
    default: return 'ระบบบันทึกการเชื่อมต่อไม่สำเร็จ กรุณาลองใหม่อีกครั้ง';
  }
}

/** Public site, for links the bot sends (they open in the teacher's browser). */
export function webUrl(path: string) {
  const base = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || PUDDING_WEB_URL).replace(/\/+$/, '');
  return `${base}${path}`;
}

/**
 * The "how to connect" picture (teacher and student steps) sent with the
 * connect button. Files live in public/; bump the version after replacing
 * them, since LINE caches images by URL.
 */
const CONNECT_GUIDE_VERSION = '1';
export function connectGuideImage() {
  return {
    originalContentUrl: webUrl(`/Pudding-LINE-Conn-Guide.jpg?v=${CONNECT_GUIDE_VERSION}`),
    previewImageUrl: webUrl(`/Pudding-LINE-Conn-Guide-preview.jpg?v=${CONNECT_GUIDE_VERSION}`),
  };
}

/** The teacher's LIFF connect page (rich-menu link); `ref` preselects the group whose button was tapped. */
export function liffConnectUrl(ref?: string) {
  const liffId = process.env.LINE_LIFF_ID || process.env.NEXT_PUBLIC_LINE_LIFF_ID;
  const query = ref ? `?g=${encodeURIComponent(ref)}` : '';
  return liffId ? `https://liff.line.me/${liffId}/connect${query}` : webUrl(`/liff/connect${query}`);
}
