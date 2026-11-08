import 'server-only';
import { fit, textCard, type BareAction } from '@/lib/line/flexKit';

const LINE_PUSH_ENDPOINT = 'https://api.line.me/v2/bot/message/push';
const LINE_REPLY_ENDPOINT = 'https://api.line.me/v2/bot/message/reply';

/** A refused LINE API call; status 429 means the monthly message quota is used up (or too many requests). */
export class LineApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * LINE refused the push because the plan's monthly messages are used up. A
 * group push costs one message per member, so a big class fails while a
 * small group may still get through.
 */
export const isLineQuotaError = (error: unknown) =>
  error instanceof LineApiError && error.status === 429 && /monthly limit/i.test(error.message);

async function sendLineMessage(endpoint: string, body: Record<string, unknown>): Promise<void> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error('LINE_CHANNEL_ACCESS_TOKEN is not configured');

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!response.ok) {
    // LINE explains a 400 in the body (e.g. which message property is invalid).
    const detail = await response.text().catch(() => '');
    throw new LineApiError(response.status, `LINE message failed with status ${response.status}${detail ? `: ${detail.slice(0, 500)}` : ''}`);
  }
}

export interface LinkButton {
  label: string;
  uri: string;
}

/**
 * Thai text is written without spaces, so a link is often followed directly by
 * Thai words ("https://forms.gle/abcภายในวันศุกร์"); Thai letters end the link.
 */
const URL_PATTERN = /https?:\/\/[^\s<>()"'\u0E00-\u0E7F]+/g;
/** LINE limit for a uri action. */
const MAX_URI_LENGTH = 1000;

/** The link as LINE accepts it in a button (a valid, encoded http(s) URI), or null to leave it in the text. */
function buttonUri(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.href.length <= MAX_URI_LENGTH ? url.href : null;
  } catch {
    return null;
  }
}
/** Buttons one reply card holds (see textCard); further links stay in the text. */
const MAX_BUTTONS = 12;
const HAS_URL = /https?:\/\//;

function cleanLabel(value: string) {
  return value.replace(/👉/g, '').replace(/^\s*\d+[.)]\s*/, '').replace(/[:：]\s*$/, '').trim();
}

/** A button already says "tap", so "กดเพื่อเช็กชื่อ" becomes "เช็กชื่อ" (and fits LINE's 20 characters). */
function buttonLabel(label: string) {
  return label.replace(/^(นักเรียน)?กด(ลิงก์นี้)?(เพื่อ)?\s*/, '').replace(/\s*ใน Pudding$/, '') || label;
}

/**
 * Turns every link in a message into a button and takes it out of the text,
 * since the button already carries it. A button is labelled from the text in
 * front of the link on the same line ("เปิด Pudding: <url>") or from the line
 * above ("👉 กดเพื่อเช็กชื่อ\n<url>"); that label text leaves the message too.
 * Links beyond what the cards can hold stay in the text.
 */
export function splitLinkButtons(text: string): { text: string; buttons: LinkButton[] } {
  const lines = text.split('\n');
  const kept: (string | null)[] = [...lines];
  const buttons: LinkButton[] = [];
  lines.forEach((line, index) => {
    const matches = [...line.matchAll(URL_PATTERN)];
    let rest = line;
    let lastIndex = 0;
    for (const match of matches) {
      const raw = match[0].replace(/[.,!?;:]+$/, '');
      const uri = buttonUri(raw);
      // A link LINE would reject as a button stays in the text, so the push still goes out.
      if (!uri) continue;
      if (!buttons.some((button) => button.uri === uri)) {
        if (buttons.length >= MAX_BUTTONS) continue;
        const before = cleanLabel(line.slice(0, match.index));
        const above = !before && index > 0 ? cleanLabel(lines[index - 1]) : '';
        const label = before || above;
        buttons.push({ label: buttonLabel(!label || label === 'เปิด' ? 'เปิด Pudding' : label), uri });
        // The line above was only this button's label.
        if (above && !HAS_URL.test(lines[index - 1])) kept[index - 1] = null;
      }
      rest = rest.replace(raw, '');
      lastIndex = (match.index ?? 0) + match[0].length;
    }
    if (rest === line) return;
    const after = line.slice(lastIndex);
    // "label: <url>" goes away whole; a link inside a sentence leaves the sentence.
    kept[index] = cleanLabel(after) || HAS_URL.test(rest) ? rest.replace(/[ \t]{2,}/g, ' ').trim() : null;
  });
  const stripped = kept
    .filter((line): line is string => line !== null)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text: stripped, buttons };
}

/**
 * The LINE messages the bot sends for this text: one Flex card with the text
 * (its first line as the title) and a button for each link, or plain text when
 * there are no links. Also what a teacher shares by hand (shareTargetPicker
 * accepts Flex messages with link buttons).
 */
export const lineMessagesForText = (text: string) => textWithLinkButtons(text);

/** The text, without its links, as a card with a button for each of them. */
function textWithLinkButtons(text: string, title?: string): Record<string, unknown>[] {
  const split = splitLinkButtons(text);
  // No links: plain text. LINE rejects a text message over 5000 characters (and with it the whole push).
  if (!split.buttons.length) return [{ type: 'text', text: fit(text, 5000) }];
  return [textCard(split.text, split.buttons.map((b) => ({ label: b.label, action: { type: 'uri', uri: b.uri } })), { altText: text, title })];
}

/** Reply with ready-made messages (e.g. Flex cards); at most 5. Free, unlike a push. */
export async function replyLineMessages(replyToken: string, messages: Record<string, unknown>[]): Promise<void> {
  await sendLineMessage(LINE_REPLY_ENDPOINT, { replyToken, messages: messages.slice(0, 5) });
}

/** Push ready-made messages to a user or group (counts toward the monthly quota: once per group member). */
export async function pushLineMessages(to: string, messages: Record<string, unknown>[]): Promise<void> {
  await sendLineMessage(LINE_PUSH_ENDPOINT, { to, messages: messages.slice(0, 5) });
}

export async function pushLineGroupText(to: string, text: string): Promise<void> {
  await sendLineMessage(LINE_PUSH_ENDPOINT, { to, messages: textWithLinkButtons(text) });
}

export async function replyLineText(replyToken: string, text: string): Promise<void> {
  await sendLineMessage(LINE_REPLY_ENDPOINT, { replyToken, messages: textWithLinkButtons(text) });
}

/**
 * Text reply with tappable quick-reply buttons under it. Tapping a button sends
 * its label as the user's own message. LINE allows 13 buttons of 20 characters.
 */
export async function replyLineTextWithQuickReplies(replyToken: string, text: string, options: string[]): Promise<void> {
  const items = options.slice(0, 13).map((label) => ({
    type: 'action',
    action: { type: 'message', label: [...label].slice(0, 20).join(''), text: label },
  }));
  const messages = textWithLinkButtons(text);
  // LINE shows quick replies only when they are on the last message.
  if (items.length) messages[messages.length - 1] = { ...messages[messages.length - 1], quickReply: { items } };
  await sendLineMessage(LINE_REPLY_ENDPOINT, { replyToken, messages });
}


export type LineAction =
  | { type: 'postback'; label: string; data: string; displayText?: string }
  | { type: 'uri'; label: string; uri: string }
  /** Tapping sends `text` as the user's own message. */
  | { type: 'message'; label: string; text: string };

function lineAction(action: LineAction) {
  if (action.type === 'postback') {
    return { type: 'postback', label: fit(action.label, 20), data: action.data, displayText: fit(action.displayText || action.label, 300) };
  }
  if (action.type === 'message') return { type: 'message', label: fit(action.label, 20), text: fit(action.text, 300) };
  return { type: 'uri', label: fit(action.label, 20), uri: action.uri };
}

const bare = (action: LineAction): BareAction =>
  action.type === 'uri'
    ? { type: 'uri', uri: action.uri }
    : action.type === 'message'
    ? { type: 'message', text: fit(action.text, 300) }
    : { type: 'postback', data: action.data, displayText: fit(action.displayText || action.label, 300) };

/**
 * Reply with an optional picture, then one Flex card: the text (the intro
 * first, when given) and a button per action, with optional quick-reply
 * buttons (up to 13) under it. Postback taps come back to the webhook
 * carrying the tapper's LINE id, so a group can show them to everyone while
 * only the right teacher's tap counts.
 */
export async function replyLineButtons(
  replyToken: string,
  options: {
    /** An image sent first (tap to view full screen). LINE wants HTTPS JPEG/PNG; the preview at most 1 MB. */
    image?: { originalContentUrl: string; previewImageUrl: string };
    intro?: string;
    text: string;
    actions: LineAction[];
    quickReplies?: LineAction[];
  }
): Promise<void> {
  const messages: Record<string, unknown>[] = [];
  if (options.image) messages.push({ type: 'image', ...options.image });
  const body = options.intro ? `${options.intro}\n\n${options.text}` : options.text;
  messages.push(
    options.actions.length
      ? textCard(body, options.actions.map((action) => ({ label: action.label, action: bare(action) })))
      : { type: 'text', text: fit(body, 5000) }
  );
  const items = (options.quickReplies || []).slice(0, 13).map((action) => ({ type: 'action', action: lineAction(action) }));
  if (items.length) messages[messages.length - 1] = { ...messages[messages.length - 1], quickReply: { items } };
  await sendLineMessage(LINE_REPLY_ENDPOINT, { replyToken, messages });
}

const LINE_API_BASE = 'https://api.line.me/v2/bot';

function lineAuthHeaders(): Record<string, string> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error('LINE_CHANNEL_ACCESS_TOKEN is not configured');
  return { Authorization: `Bearer ${token}` };
}

/** True when the user is a member of the group (works for unverified Official Accounts). */
export async function isGroupMember(groupId: string, userId: string): Promise<boolean> {
  const response = await fetch(
    `${LINE_API_BASE}/group/${encodeURIComponent(groupId)}/member/${encodeURIComponent(userId)}`,
    { headers: lineAuthHeaders(), cache: 'no-store' }
  );
  if (response.status === 404) return false;
  if (!response.ok) throw new Error(`LINE group member lookup failed with status ${response.status}`);
  return true;
}

/** A group member's LINE display name, or null when LINE does not say. */
export async function getGroupMemberName(groupId: string, userId: string): Promise<string | null> {
  try {
    const response = await fetch(
      `${LINE_API_BASE}/group/${encodeURIComponent(groupId)}/member/${encodeURIComponent(userId)}`,
      { headers: lineAuthHeaders(), cache: 'no-store' }
    );
    if (!response.ok) return null;
    return ((await response.json()) as { displayName?: string }).displayName || null;
  } catch {
    return null;
  }
}

export async function getGroupSummary(groupId: string): Promise<{ groupName?: string } | null> {
  const response = await fetch(`${LINE_API_BASE}/group/${encodeURIComponent(groupId)}/summary`, {
    headers: lineAuthHeaders(),
    cache: 'no-store',
  });
  if (!response.ok) return null;
  return response.json();
}

/**
 * Whether the bot is still in the group: 'gone' only when LINE says so
 * (404/403), 'unknown' when LINE could not be asked (network, 5xx, no token).
 */
export async function groupPresence(groupId: string): Promise<{ state: 'in'; groupName?: string } | { state: 'gone' } | { state: 'unknown' }> {
  try {
    const response = await fetch(`${LINE_API_BASE}/group/${encodeURIComponent(groupId)}/summary`, { headers: lineAuthHeaders(), cache: 'no-store' });
    if (response.ok) return { state: 'in', groupName: ((await response.json()) as { groupName?: string }).groupName };
    return response.status === 404 || response.status === 403 ? { state: 'gone' } : { state: 'unknown' };
  } catch {
    return { state: 'unknown' };
  }
}

/** Makes the bot leave the group. A 404 means it already left, which is fine. */
export async function leaveGroup(groupId: string): Promise<void> {
  const response = await fetch(`${LINE_API_BASE}/group/${encodeURIComponent(groupId)}/leave`, {
    method: 'POST',
    headers: lineAuthHeaders(),
    cache: 'no-store',
  });
  if (!response.ok && response.status !== 404) throw new Error(`LINE leave group failed with status ${response.status}`);
}

async function lineGet<T>(path: string): Promise<T | null> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return null;
  try {
    const response = await fetch(`https://api.line.me${path}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
}

/**
 * Whether the plan's messages left this month cover one push to this group
 * (LINE bills a group push once per member). Three reads run side by side:
 * the plan's limit, this month's usage and the group's member count.
 * - true: enough left (or the plan has no limit)
 * - false: not enough; pushing would fail with "monthly limit", so don't
 * - null: could not tell (a read failed); try the push and let LINE decide
 */
export async function groupPushAffordable(groupId: string): Promise<{ affordable: boolean | null; remaining?: number; members?: number }> {
  const [quota, usage, members] = await Promise.all([
    lineGet<{ type: 'none' | 'limited'; value?: number }>('/v2/bot/message/quota'),
    lineGet<{ totalUsage: number }>('/v2/bot/message/quota/consumption'),
    lineGet<{ count: number }>(`/v2/bot/group/${encodeURIComponent(groupId)}/members/count`),
  ]);
  if (quota?.type === 'none') return { affordable: true };
  if (!quota || quota.value == null || !usage || !members) return { affordable: null };
  const remaining = Math.max(0, quota.value - usage.totalUsage);
  return { affordable: remaining >= members.count, remaining, members: members.count };
}
