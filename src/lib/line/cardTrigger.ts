import { buildLiffUrl } from '@/lib/line/liffLink';

/**
 * Card triggers: what the teacher's LINE posts into the class group so the
 * bot answers with a card (a reply, which uses no message quota). The teacher
 * LIFF pages send it with liff.sendMessages straight into the group they were
 * opened from; on the web it is shared with /liff/share. Each trigger is one
 * line saying what it is, then a student LIFF link that still works on its own
 * (where the bot is not in the group). `card=<kind>` marks the link as a
 * request; other messages that link to a work (a pasted reminder) never get a card.
 *
 * The webhook only answers a teacher or TA of the group's own classroom, and
 * only for that classroom's work or check-in, so the links need no signature.
 */

export type CardKind = 'work' | 'attendance' | 'invite' | 'guide' | 'remind' | 'results';
const KINDS: CardKind[] = ['work', 'attendance', 'invite', 'guide', 'remind', 'results'];

type TriggerClassroom = { id: string; invite_code?: string | null };

export type CardTrigger = { kind: CardKind; classroomId?: string; assignmentId?: string; sessionId?: string };

/** The trigger text for a card, or null without a LIFF id. */
export function cardTriggerText(
  kind: CardKind,
  classroom: TriggerClassroom,
  item: { assignment?: { id: string; title: string; is_exam?: boolean }; session?: { id: string; title: string }; classroomTitle?: string } = {}
): string | null {
  const base = { classroomId: classroom.id, inviteCode: classroom.invite_code };
  const { assignment, session } = item;
  let url: string | null = null;
  let label = '';
  if (kind === 'work' || kind === 'remind' || kind === 'results') {
    if (!assignment) return null;
    url = buildLiffUrl({ ...base, assignmentId: assignment.id });
    const what = assignment.is_exam ? 'ข้อสอบ' : 'งาน';
    label =
      kind === 'work'
        ? `${assignment.is_exam ? '📝' : '📋'} ${what}: ${assignment.title}`
        : kind === 'remind'
        ? `🔔 ทวง${what}: ${assignment.title}`
        : `📣 ประกาศคะแนน: ${assignment.title}`;
  } else if (kind === 'attendance') {
    if (!session) return null;
    url = buildLiffUrl({ ...base, view: 'attendance' });
    if (url) url += `&sid=${encodeURIComponent(session.id)}`;
    label = `⏰ เช็กชื่อ: ${session.title}`;
  } else if (kind === 'invite') {
    url = buildLiffUrl(base);
    label = `🎓 เชิญเข้าห้องเรียน${item.classroomTitle ? ` ${item.classroomTitle}` : ''}`;
  } else {
    url = buildLiffUrl(base);
    label = '📣 วิธีใช้ Pudding สำหรับนักเรียน';
  }
  if (!url) return null;
  return `${label} 👇\n${url}&card=${kind}`;
}

/** The card a group message asks for, if it carries one of our trigger links. */
export function parseCardTrigger(text: string): CardTrigger | null {
  if (!text.includes('card=')) return null;
  const liffId = process.env.LINE_LIFF_ID || process.env.NEXT_PUBLIC_LINE_LIFF_ID;
  for (const match of text.matchAll(/https?:\/\/[^\s<>"']+/g)) {
    let url: URL;
    try {
      url = new URL(match[0]);
    } catch {
      continue;
    }
    const ours = url.hostname === 'liff.line.me' ? !liffId || url.pathname.startsWith(`/${liffId}`) : url.pathname.startsWith('/liff');
    if (!ours) continue;
    const raw = url.searchParams.get('card');
    // "card=1": the first version of the work trigger.
    const kind = raw === '1' ? 'work' : (KINDS.find((item) => item === raw) as CardKind | undefined);
    if (!kind) continue;
    const id = (name: string) => {
      const value = url.searchParams.get(name);
      return value && /^[\w-]{1,80}$/.test(value) ? value : undefined;
    };
    const trigger: CardTrigger = { kind, classroomId: id('classId'), assignmentId: id('assignmentId'), sessionId: id('sid') };
    if ((kind === 'work' || kind === 'remind' || kind === 'results') && !trigger.assignmentId) continue;
    if (kind === 'attendance' && !trigger.sessionId) continue;
    return trigger;
  }
  return null;
}
