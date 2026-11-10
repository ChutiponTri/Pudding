import { NextRequest, NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { announceScheduledPosts } from '@/lib/line/classroomAnnouncement';
import { deleteExpiredAssignmentDrafts } from '@/lib/server/assignmentDrafts';
import { runDailySummary } from '@/lib/server/dailySummary';
import { cronAuthError } from '@/lib/server/cronAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Run from a scheduler every five minutes (see supabase_reminder_cron.sql; the
 * path keeps its old name so the job needs no change). It releases the LINE
 * card of scheduled work when its publish time comes, and deletes drafts that
 * were never published within DRAFT_RETENTION_DAYS. There are no automatic
 * deadline reminders: teachers remind with "ทวงงาน" (the picture the bot
 * answers with the reminder card and @mentions). From 17:00 it also sends
 * each teacher's "สรุปประจำวัน" once (see dailySummary.ts).
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
  const denied = cronAuthError(request);
  if (denied) return denied;
  const supabase = createServiceSupabaseClient();
  const now = new Date();
  const announced = await announceScheduledPosts(supabase, now);
  const expiredDrafts = await deleteExpiredAssignmentDrafts(supabase, now);
  const dailySummary = await runDailySummary(supabase, now).catch((error: unknown) => {
    console.error('Daily summary failed:', error);
    return { error: error instanceof Error ? error.message : String(error) };
  });
  return NextResponse.json({ ok: true, announced, expiredDrafts, dailySummary });
}
