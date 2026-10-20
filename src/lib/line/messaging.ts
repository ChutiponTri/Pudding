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

export async function pushLineGroupText(to: string, text: string): Promise<void> {
  await sendLineMessage(LINE_PUSH_ENDPOINT, { to, messages: [{ type: 'text', text }] });
}

export async function replyLineText(replyToken: string, text: string): Promise<void> {
  await sendLineMessage(LINE_REPLY_ENDPOINT, { replyToken, messages: [{ type: 'text', text }] });
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
