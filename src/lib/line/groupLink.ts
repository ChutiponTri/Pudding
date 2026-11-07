import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { after } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { getGroupSummary, isGroupMember } from '@/lib/line/messaging';
import { signalClassroom } from '@/lib/realtime/classroomSignal';
import { PUDDING_WEB_URL } from '@/lib/line/teacherFaq';
import { teacherAccessOf, type TeacherAccess } from '@/lib/utils/teacherProfile';

/**
 * Linking a classroom to a LINE group needs two halves:
 *   - who + which classroom: an approved teacher and one of their classrooms
 *     (a "waiting" request on the classroom, or a tap that names it), and
 *   - which group: a LINE group the bot is in (line_pending_groups).
 * Every entry point (web button, LIFF page from the rich menu, the bot's
 * buttons in a group) supplies one half; whichever half comes second links.
 * This module holds what the webhook and the API routes share.
 */

export type ServiceClient = ReturnType<typeof createServiceSupabaseClient>;

/** How long a "connect this classroom" request waits for its group. Only that teacher can complete it. */
export const CONNECT_INTENT_TTL_MS = 24 * 60 * 60 * 1000;
/** Unlinked groups older than this are not offered any more (the bot may sit there forgotten). */
const PENDING_GROUP_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_CANDIDATE_GROUPS = 10;
/** "Create a classroom for this group" links from the bot. */
const LINK_TOKEN_TTL_MS = 30 * 60 * 1000;

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
  line_connection_status?: string | null;
  /** Clerk id of the teacher who asked to connect this classroom (see armConnectRequest). */
  line_connection_token?: string | null;
  /** Group already shown the "move this group?" prompt, so ordinary chat does not repeat it. */
  line_connection_token_hash?: string | null;
  line_connection_token_expires_at?: string | null;
  created_at?: string | null;
};

export const LINK_COLUMNS = 'id, name, invite_code, teacher_id, teachers, course_name, subject_code, semester, year_ce, academic_year, line_group_id, line_group_name, line_connection_status, line_connection_token, line_connection_token_hash, line_connection_token_expires_at, created_at';

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

/** Classrooms the teacher may link (newest first), optionally only those without a group. */
export async function listLinkableClassrooms(supabase: ServiceClient, teacherId: string, options: { unlinkedOnly?: boolean } = {}): Promise<LinkClassroom[]> {
  const [owned, shared] = await Promise.all([
    supabase.from('classrooms').select(LINK_COLUMNS).eq('teacher_id', teacherId),
    supabase.from('classrooms').select(LINK_COLUMNS).contains('teachers', JSON.stringify([{ teacher_id: teacherId }])),
  ]);
  const byId = new Map<string, LinkClassroom>();
  for (const row of [...((owned.data || []) as LinkClassroom[]), ...((shared.data || []) as LinkClassroom[])]) byId.set(row.id, row);
  return [...byId.values()]
    .filter((row) => canLinkLine(row, teacherId) && (!options.unlinkedOnly || !row.line_group_id))
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
}

/**
 * Classrooms still waiting for a group, optionally only those requested by one
 * teacher. Expired requests and requesters who can no longer link the
 * classroom are dropped.
 */
export async function findWaitingClassrooms(supabase: ServiceClient, requesterId?: string): Promise<LinkClassroom[]> {
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
      canLinkLine(item, item.line_connection_token as string)
  );
}

/** Open teacher pages refresh the classroom's LINE status (no classroom signal is sent otherwise). */
export function signalLineStatus(...classroomIds: Array<string | null | undefined>) {
  after(() => Promise.all(classroomIds.map((id) => signalClassroom(id, { type: 'roster', action: 'updated' }))));
}

// ---------------------------------------------------------------------------
// Groups the bot is in but that are not linked yet
// ---------------------------------------------------------------------------

/** Remembers a group the bot joined (or found unlinked), so the web and LIFF page can offer it. */
export async function rememberPendingGroup(supabase: ServiceClient, groupId: string, groupName?: string | null, options: { prompted?: boolean } = {}) {
  const { error } = await supabase.from('line_pending_groups').upsert({
    group_id: groupId,
    group_name: groupName || null,
    joined_at: new Date().toISOString(),
    prompted_at: options.prompted ? new Date().toISOString() : null,
  });
  if (error) console.warn('LINE pending group save failed (run supabase_line_connect_flow_update.sql):', error.message);
}

export async function forgetPendingGroup(supabase: ServiceClient, groupId: string) {
  const { error } = await supabase.from('line_pending_groups').delete().eq('group_id', groupId);
  if (error) console.warn('LINE pending group delete failed:', error.message);
}

/**
 * The first teacher message in an unlinked group gets the "เชื่อมห้องเรียน"
 * button once; later chat does not. Returns true when this call claimed it.
 */
export async function claimGroupPrompt(supabase: ServiceClient, groupId: string): Promise<boolean> {
  const { data: pending, error } = await supabase.from('line_pending_groups').select('prompted_at').eq('group_id', groupId).maybeSingle();
  if (error) return false;
  if (!pending) {
    // Bot added before this table existed (or the row was lost): only an unlinked group counts.
    if (await findLinkedClassroom(supabase, groupId)) return false;
    const summary = await getGroupSummary(groupId).catch(() => null);
    await rememberPendingGroup(supabase, groupId, summary?.groupName, { prompted: true });
    return true;
  }
  if (pending.prompted_at) return false;
  const { data: claimed } = await supabase
    .from('line_pending_groups')
    .update({ prompted_at: new Date().toISOString() })
    .eq('group_id', groupId)
    .is('prompted_at', null)
    .select('group_id');
  return Boolean(claimed?.length);
}

export type CandidateGroup = { groupId: string; groupName?: string };

/**
 * Unlinked groups the bot is in that this teacher is a member of: the web and
 * LIFF page offer them for a one-click link. Membership is asked from LINE,
 * so a teacher only ever sees their own groups.
 */
export async function findCandidateGroups(supabase: ServiceClient, teacherLineUid: string | null | undefined): Promise<CandidateGroup[]> {
  if (!teacherLineUid) return [];
  const since = new Date(Date.now() - PENDING_GROUP_MAX_AGE_MS).toISOString();
  const { data, error } = await supabase
    .from('line_pending_groups')
    .select('group_id, group_name')
    .gte('joined_at', since)
    .order('joined_at', { ascending: false })
    .limit(MAX_CANDIDATE_GROUPS);
  if (error || !data?.length) return [];
  const ids = data.map((row) => row.group_id as string);
  const { data: linked } = await supabase.from('classrooms').select('line_group_id').in('line_group_id', ids);
  const linkedIds = new Set((linked || []).map((row) => row.line_group_id as string));
  // Linked elsewhere in the meantime: tidy up.
  for (const id of linkedIds) void forgetPendingGroup(supabase, id);
  const open = data.filter((row) => !linkedIds.has(row.group_id as string));
  const checks = await Promise.allSettled(open.map((row) => isGroupMember(row.group_id as string, teacherLineUid)));
  return open
    .filter((_, index) => checks[index].status === 'fulfilled' && (checks[index] as PromiseFulfilledResult<boolean>).value)
    .map((row) => ({ groupId: row.group_id as string, groupName: (row.group_name as string | null) || undefined }));
}

// ---------------------------------------------------------------------------
// Requests and links
// ---------------------------------------------------------------------------

/**
 * Records that this teacher wants to connect this classroom. Their next group
 * message, the bot's join prompt or a confirm tap completes it. One request
 * per teacher, so a later group can never match an older, forgotten request.
 */
export async function armConnectRequest(supabase: ServiceClient, teacherId: string, classroomId: string): Promise<{ expiresAt?: string; error?: string }> {
  const { error: cancelError } = await supabase.from('classrooms').update({
    line_connection_status: 'disconnected',
    line_connection_token: null,
    line_connection_token_hash: null,
    line_connection_token_expires_at: null,
  }).eq('line_connection_status', 'waiting').eq('line_connection_token', teacherId).neq('id', classroomId);
  if (cancelError) console.warn('Could not cancel older LINE connect requests:', cancelError);

  const expiresAt = new Date(Date.now() + CONNECT_INTENT_TTL_MS).toISOString();
  const { error } = await supabase.from('classrooms').update({
    line_connection_status: 'waiting',
    line_connection_token_hash: null,
    line_connection_token: teacherId,
    line_connection_token_expires_at: expiresAt,
  }).eq('id', classroomId).is('line_group_id', null);
  if (error) return { error: error.message };
  return { expiresAt };
}

export async function cancelConnectRequest(supabase: ServiceClient, classroomId: string) {
  await supabase.from('classrooms').update({
    line_connection_status: 'disconnected',
    line_connection_token: null,
    line_connection_token_hash: null,
    line_connection_token_expires_at: null,
  }).eq('id', classroomId).eq('line_connection_status', 'waiting');
}

export type LinkResult =
  | { ok: true; groupName?: string }
  | { ok: false; reason: 'group-taken' | 'classroom-taken' | 'changed' | 'failed' };

/**
 * Links the group to `classroom`. When `replacing` is given (the teacher chose
 * to move the group from an older classroom), that classroom is unlinked
 * first; nothing changes if the group's link moved on in the meantime. The
 * caller has already checked who may do this.
 */
export async function linkClassroomToGroup(
  supabase: ServiceClient,
  groupId: string,
  classroom: LinkClassroom,
  replacing?: LinkClassroom | null
): Promise<LinkResult> {
  if (replacing) {
    const { data: unlinked } = await supabase.from('classrooms').update({
      line_group_id: null,
      line_group_name: null,
      line_connection_status: 'disconnected',
      line_connected_at: null,
    }).eq('id', replacing.id).eq('line_group_id', groupId).select('id');
    if (!unlinked?.length) return { ok: false, reason: 'changed' };
  } else if (await findLinkedClassroom(supabase, groupId)) {
    return { ok: false, reason: 'group-taken' };
  }

  const summary = await getGroupSummary(groupId).catch(() => null);
  const { data: updated, error } = await supabase.from('classrooms').update({
    line_group_id: groupId,
    line_group_name: summary?.groupName || null,
    line_connection_status: 'connected',
    line_connection_token_hash: null,
    line_connection_token: null,
    line_connection_token_expires_at: null,
    line_connected_at: new Date().toISOString(),
  }).eq('id', classroom.id).is('line_group_id', null).select('id');
  if (error || !updated?.length) {
    if (error) console.error('LINE classroom link failed:', error);
    if (replacing) {
      // Put the old link back rather than leave the group linked to nothing.
      await supabase.from('classrooms').update({
        line_group_id: groupId,
        line_group_name: summary?.groupName || null,
        line_connection_status: 'connected',
        line_connected_at: new Date().toISOString(),
      }).eq('id', replacing.id).is('line_group_id', null);
    }
    return { ok: false, reason: error ? 'failed' : 'classroom-taken' };
  }
  await forgetPendingGroup(supabase, groupId);
  signalLineStatus(classroom.id, replacing?.id);
  return { ok: true, groupName: summary?.groupName || undefined };
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

/**
 * Links a group the teacher picked on the web or LIFF page. LINE confirms the
 * teacher is in that group (so nobody can link a group they are not in) and
 * the classroom must still be free.
 */
export async function linkCandidateGroup(
  supabase: ServiceClient,
  teacher: { id: string; lineUid: string },
  classroom: LinkClassroom,
  groupId: string
): Promise<LinkResult | { ok: false; reason: 'not-member' }> {
  let member = false;
  try {
    member = await isGroupMember(groupId, teacher.lineUid);
  } catch (error) {
    console.error('LINE group membership check failed:', error);
  }
  if (!member) return { ok: false, reason: 'not-member' };
  if (classroom.line_group_id) return { ok: false, reason: 'classroom-taken' };
  return linkClassroomToGroup(supabase, groupId, classroom);
}

export function linkErrorMessage(reason: string) {
  switch (reason) {
    case 'not-member': return 'ไม่พบคุณครูในกลุ่มนี้ หรือบอทไม่ได้อยู่ในกลุ่มแล้ว';
    case 'group-taken': return 'กลุ่มนี้เชื่อมกับห้องเรียนอื่นแล้ว';
    case 'classroom-taken': return 'ห้องเรียนนี้เชื่อมกับกลุ่ม LINE อื่นอยู่แล้ว';
    case 'changed': return 'สถานะกลุ่มเปลี่ยนไปแล้ว กรุณาลองใหม่อีกครั้ง';
    case 'expired': return 'ลิงก์หมดอายุแล้ว กรุณากด “เชื่อมห้องเรียน” ในกลุ่ม LINE อีกครั้ง';
    default: return 'ระบบบันทึกการเชื่อมต่อไม่สำเร็จ กรุณาลองใหม่อีกครั้ง';
  }
}

// ---------------------------------------------------------------------------
// "Create a classroom for this group" tokens
// ---------------------------------------------------------------------------

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** Single-use token for one teacher and one group; only its hash is stored. */
export async function createLinkToken(supabase: ServiceClient, groupId: string, teacherId: string): Promise<string | null> {
  const token = randomBytes(24).toString('base64url');
  const { error } = await supabase.from('line_link_tokens').insert({
    token_hash: hashToken(token),
    group_id: groupId,
    teacher_id: teacherId,
    expires_at: new Date(Date.now() + LINK_TOKEN_TTL_MS).toISOString(),
  });
  if (error) {
    console.warn('LINE link token save failed (run supabase_line_connect_flow_update.sql):', error.message);
    return null;
  }
  return token;
}

/** Uses up the token if it belongs to this teacher and is still valid; returns its group. */
export async function claimLinkToken(supabase: ServiceClient, token: string, teacherId: string): Promise<string | null> {
  if (!token) return null;
  const { data } = await supabase
    .from('line_link_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('token_hash', hashToken(token))
    .eq('teacher_id', teacherId)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('group_id');
  return (data?.[0]?.group_id as string | undefined) || null;
}

/** Public site, for links the bot sends (they open in the teacher's browser). */
export function webUrl(path: string) {
  const base = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || PUDDING_WEB_URL).replace(/\/+$/, '');
  return `${base}${path}`;
}

/** The teacher's LIFF page for connecting groups (also the rich-menu link). */
export function liffConnectUrl() {
  const liffId = process.env.LINE_LIFF_ID || process.env.NEXT_PUBLIC_LINE_LIFF_ID;
  return liffId ? `https://liff.line.me/${liffId}/connect` : webUrl('/liff/connect');
}
