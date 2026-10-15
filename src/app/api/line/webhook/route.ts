import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

function isValidSignature(body: string, signature: string | null) {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret || !signature) return false;
  const expected = createHmac('sha256', secret).update(body).digest('base64');
  return expected.length === signature.length && timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

/**
 * Add the bot to a LINE group, then send: #pudding <classroom invite code>.
 * The webhook stores the group id against that classroom for reminders.
 */
export async function POST(request: NextRequest) {
  const body = await request.text();
  if (!isValidSignature(body, request.headers.get('x-line-signature'))) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const payload = JSON.parse(body) as { events?: Array<{ source?: { type?: string; groupId?: string }; message?: { type?: string; text?: string } }> };
  const supabase = await createServerSupabaseClient();
  for (const event of payload.events || []) {
    const groupId = event.source?.type === 'group' ? event.source.groupId : undefined;
    const match = event.message?.type === 'text' ? event.message.text?.trim().match(/^#pudding\s+(.+)$/i) : null;
    if (!groupId || !match) continue;
    await supabase.from('classrooms').update({ line_group_id: groupId }).eq('invite_code', match[1].trim());
  }
  return NextResponse.json({ ok: true });
}
