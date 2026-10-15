import { createHash, randomBytes } from 'node:crypto';
import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TOKEN_TTL_MS = 10 * 60 * 1000;

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createServiceSupabaseClient();
  const { data: teacher, error } = await supabase
    .from('users')
    .select('line_uid, line_link_status, line_link_token, line_link_token_expires_at')
    .eq('id', userId)
    .eq('role', 'teacher')
    .maybeSingle();
  if (error) {
    console.error('LINE teacher link lookup failed:', error);
    return NextResponse.json({ error: 'LINE teacher link is not configured' }, { status: 503 });
  }
  if (!teacher) return NextResponse.json({ error: 'Teacher account not found' }, { status: 404 });

  const expired = teacher.line_link_status === 'waiting'
    && teacher.line_link_token_expires_at
    && new Date(teacher.line_link_token_expires_at).getTime() <= Date.now();
  if (expired) {
    await supabase.from('users').update({
      line_link_status: 'disconnected',
      line_link_token: null,
      line_link_token_hash: null,
      line_link_token_expires_at: null,
    }).eq('id', userId);
  }

  return NextResponse.json({
    status: expired ? 'disconnected' : (teacher.line_link_status || (teacher.line_uid ? 'connected' : 'disconnected')),
    lineUid: teacher.line_uid || undefined,
    token: expired ? undefined : teacher.line_link_token,
    expiresAt: expired ? undefined : teacher.line_link_token_expires_at,
  });
}

export async function POST() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createServiceSupabaseClient();
  const token = randomBytes(4).toString('hex').toUpperCase();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
  const { error } = await supabase.from('users').update({
    line_link_status: 'waiting',
    line_link_token_hash: hashToken(token),
    line_link_token: token,
    line_link_token_expires_at: expiresAt,
  }).eq('id', userId).eq('role', 'teacher');
  if (error) {
    console.error('LINE teacher link creation failed:', error);
    return NextResponse.json({ error: 'LINE teacher link is not configured' }, { status: 503 });
  }
  return NextResponse.json({ status: 'waiting', token, expiresAt });
}
