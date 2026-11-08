import { NextRequest, NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { announceScheduledPosts } from '@/lib/line/classroomAnnouncement';
import { deleteExpiredAssignmentDrafts } from '@/lib/server/assignmentDrafts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Run from a scheduler every five minutes (see supabase_reminder_cron.sql; the
 * path keeps its old name so the job needs no change). It releases the LINE
 * card of scheduled work when its publish time comes, and deletes drafts that
 * were never published within DRAFT_RETENTION_DAYS. There are no automatic
 * deadline reminders: teachers remind with "ทวงงาน" (the picture the bot
 * answers with the reminder card and @mentions).
 * Accepts GET (Vercel Cron, which sends `Authorization: Bearer $CRON_SECRET`)
 * and POST (pg_cron / any external scheduler).
 */
export async function GET(request: NextRequest) {
  return run(request);
}

export async function POST(request: NextRequest) {
  return run(request);
}

async function run(request: NextRequest) {
  const secrets = [process.env.LINE_REMINDER_CRON_SECRET, process.env.CRON_SECRET].filter(Boolean);
  if (!secrets.length) {
    return NextResponse.json({ error: 'LINE_REMINDER_CRON_SECRET is not configured' }, { status: 503 });
  }
  const authorization = request.headers.get('authorization');
  if (!secrets.some((secret) => authorization === `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const supabase = createServiceSupabaseClient();
  const now = new Date();
  const announced = await announceScheduledPosts(supabase, now);
  const expiredDrafts = await deleteExpiredAssignmentDrafts(supabase, now);
  return NextResponse.json({ ok: true, announced, expiredDrafts });
}
