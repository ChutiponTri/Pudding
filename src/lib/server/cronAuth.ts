import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Scheduler routes take `Authorization: Bearer <secret>` with
 * LINE_REMINDER_CRON_SECRET (pg_cron) or CRON_SECRET (Vercel Cron).
 * Returns the refusal, or null when the caller may go on.
 */
export function cronAuthError(request: NextRequest): NextResponse | null {
  const secrets = [process.env.LINE_REMINDER_CRON_SECRET, process.env.CRON_SECRET].filter(Boolean);
  if (!secrets.length) {
    return NextResponse.json({ error: 'LINE_REMINDER_CRON_SECRET is not configured' }, { status: 503 });
  }
  const authorization = request.headers.get('authorization');
  if (!secrets.some((secret) => authorization === `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}
