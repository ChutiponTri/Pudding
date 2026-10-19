import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { syncTeacherLineIdentity } from '@/lib/line/teacherIdentity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Links the signed-in teacher's LINE account automatically from their Clerk
 * LINE sign-in and reports whether they have added the bot as a friend.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const identity = await syncTeacherLineIdentity(userId);
    if (identity.status === 'not_found') {
      return NextResponse.json({ error: 'Teacher account not found' }, { status: 404 });
    }
    const basicId = process.env.LINE_BOT_BASIC_ID || process.env.NEXT_PUBLIC_LINE_BOT_BASIC_ID;
    return NextResponse.json({
      ...identity,
      addFriendUrl: basicId ? `https://line.me/R/ti/p/${encodeURIComponent(basicId)}` : undefined,
    });
  } catch (error) {
    console.error('LINE teacher identity sync failed:', error);
    return NextResponse.json({ error: 'LINE teacher link is not configured' }, { status: 503 });
  }
}
