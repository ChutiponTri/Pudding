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
