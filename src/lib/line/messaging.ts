import 'server-only';

const LINE_PUSH_ENDPOINT = 'https://api.line.me/v2/bot/message/push';
const LINE_REPLY_ENDPOINT = 'https://api.line.me/v2/bot/message/reply';

async function sendLineMessage(endpoint: string, body: Record<string, unknown>): Promise<void> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error('LINE_CHANNEL_ACCESS_TOKEN is not configured');

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`LINE message failed with status ${response.status}`);
}

export interface LinkButton {
  label: string;
  uri: string;
}

const URL_PATTERN = /https?:\/\/[^\s<>()"']+/g;
/** LINE allows 4 buttons per card and 5 messages per request (the text + 4 cards). */
const BUTTONS_PER_CARD = 4;
const MAX_CARDS = 4;
const MAX_BUTTONS = BUTTONS_PER_CARD * MAX_CARDS;
const HAS_URL = /https?:\/\//;

const fit = (value: string, max: number) => ([...value].length > max ? `${[...value].slice(0, max - 1).join('')}…` : value);

function cleanLabel(value: string) {
  return value.replace(/👉/g, '').replace(/^\s*\d+[.)]\s*/, '').replace(/[:：]\s*$/, '').trim();
}

/** A button already says "tap", so "กดเพื่อเช็คชื่อ" becomes "เช็คชื่อ" (and fits LINE's 20 characters). */
function buttonLabel(label: string) {
  return label.replace(/^(นักเรียน)?กด(ลิงก์นี้)?(เพื่อ)?\s*/, '').replace(/\s*ใน Pudding$/, '') || label;
}

/**
 * Turns every link in a message into a button and takes it out of the text,
 * since the button already carries it. A button is labelled from the text in
 * front of the link on the same line ("เปิด Pudding: <url>") or from the line
 * above ("👉 กดเพื่อเช็คชื่อ\n<url>"); that label text leaves the message too.
 * Links beyond what the cards can hold stay in the text.
 */
export function splitLinkButtons(text: string): { text: string; buttons: LinkButton[] } {
  const lines = text.split('\n');
  const kept: (string | null)[] = [...lines];
  const buttons: LinkButton[] = [];
  lines.forEach((line, index) => {
    const matches = [...line.matchAll(URL_PATTERN)];
    let rest = line;
    for (const match of matches) {
      const uri = match[0].replace(/[.,!?;:]+$/, '');
      if (!buttons.some((button) => button.uri === uri)) {
        if (buttons.length >= MAX_BUTTONS) continue;
        const before = cleanLabel(line.slice(0, match.index));
        const above = !before && index > 0 ? cleanLabel(lines[index - 1]) : '';
        const label = before || above;
        buttons.push({ label: buttonLabel(!label || label === 'เปิด' ? 'เปิด Pudding' : label), uri });
        // The line above was only this button's label.
        if (above && !HAS_URL.test(lines[index - 1])) kept[index - 1] = null;
      }
      rest = rest.replace(uri, '');
    }
    if (rest === line) return;
    const last = matches[matches.length - 1];
    const after = line.slice(last.index + last[0].length);
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

/** Cards of link buttons to show under a text message. */
function linkCards(buttons: LinkButton[], cardText = 'แตะปุ่มด้านล่างเพื่อเปิด 👇') {
  const cards: Record<string, unknown>[] = [];
  for (let i = 0; i < buttons.length && cards.length < MAX_CARDS; i += BUTTONS_PER_CARD) {
    const group = buttons.slice(i, i + BUTTONS_PER_CARD);
    cards.push({
      type: 'template',
      altText: fit(group.map((button) => `${button.label}: ${button.uri}`).join('\n'), 400),
      template: {
        type: 'buttons',
        text: fit(cardText, 160),
        actions: group.map((button) => ({ type: 'uri', label: fit(button.label, 20), uri: button.uri })),
      },
    });
  }
  return cards;
}

/** A text message, without its links, followed by a button for each of them. */
function textWithLinkButtons(text: string, cardText?: string): Record<string, unknown>[] {
  const split = splitLinkButtons(text);
  const cards = linkCards(split.buttons, cardText);
  // A message that was nothing but a link becomes just its button.
  return split.text || !cards.length ? [{ type: 'text', text: split.text || text }, ...cards] : cards;
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

/** Text reply whose link card has its own wording and button label. */
export async function replyLineTextWithLinkButton(
  replyToken: string,
  text: string,
  button: { text: string; label: string; uri: string }
): Promise<void> {
  await sendLineMessage(LINE_REPLY_ENDPOINT, {
    replyToken,
    messages: [{ type: 'text', text: splitLinkButtons(text).text || text }, ...linkCards([{ label: button.label, uri: button.uri }], button.text)],
  });
}

export interface LinePostbackChoice {
  label: string;
  data: string;
  displayText?: string;
}

/** Two-button yes/no prompt; the tap comes back to the webhook as a postback event. */
export async function replyLineConfirm(
  replyToken: string,
  text: string,
  yes: LinePostbackChoice,
  no: LinePostbackChoice
): Promise<void> {
  const action = (choice: LinePostbackChoice) => ({ type: 'postback', label: choice.label, data: choice.data, displayText: choice.displayText || choice.label });
  await sendLineMessage(LINE_REPLY_ENDPOINT, {
    replyToken,
    messages: [{
      type: 'template',
      altText: text.slice(0, 400),
      // LINE caps confirm-template text at 240 characters.
      template: { type: 'confirm', text: text.length > 240 ? `${text.slice(0, 239)}…` : text, actions: [action(yes), action(no)] },
    }],
  });
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

export async function getGroupSummary(groupId: string): Promise<{ groupName?: string } | null> {
  const response = await fetch(`${LINE_API_BASE}/group/${encodeURIComponent(groupId)}/summary`, {
    headers: lineAuthHeaders(),
    cache: 'no-store',
  });
  if (!response.ok) return null;
  return response.json();
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
