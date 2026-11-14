import { NextRequest, NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { deleteExpiredAssignmentDrafts } from '@/lib/server/assignmentDrafts';
import { runDailySummary } from '@/lib/server/dailySummary';
import { cronAuthError } from '@/lib/server/cronAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Daily job, called by pg_cron hourly 17:00–21:00 Bangkok (supabase_daily_cron.sql).
 * Sends each teacher's "สรุปประจำวัน" at most once every 2 days (see dailySummary.ts;
 * later runs only pick up teachers an earlier run missed; skipped when the quota is out) and deletes drafts never published
 * within DRAFT_RETENTION_DAYS (also swept on page loads, see dataActions.ts).
 * Accepts GET (Vercel Cron, `Authorization: Bearer $CRON_SECRET`) and POST
 * (pg_cron, `Bearer $LINE_REMINDER_CRON_SECRET`).
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
  const expiredDrafts = await deleteExpiredAssignmentDrafts(supabase, now);
  const dailySummary = await runDailySummary(supabase, now).catch((error: unknown) => {
    console.error('Daily summary failed:', error);
    return { error: error instanceof Error ? error.message : String(error) };
  });
  return NextResponse.json({ ok: true, expiredDrafts, dailySummary });
}
