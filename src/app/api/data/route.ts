import { NextRequest, NextResponse } from 'next/server';
import { getActor } from '@/lib/auth/actor';
import { errorResponse, HttpError } from '@/lib/server/access';
import { createDataContext, dataActions, type DataActionName } from '@/lib/server/dataActions';
import { requireTeacherAccess } from '@/lib/server/teacherProfileGuard';

/** What a teacher may call before their profile is complete and the admin has approved them. */
const PROFILE_SETUP_ACTIONS = new Set<string>(['syncClerkUser', 'updateTeacherProfile']);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/data  { action, args }
 * The browser's only door to the database: runs one data action as the
 * verified caller (Clerk teacher or LINE-verified student). Each action checks
 * what that caller may read or change.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const action = body.action as DataActionName;
    const args = Array.isArray(body.args) ? body.args : [];
    if (typeof action !== 'string' || !Object.prototype.hasOwnProperty.call(dataActions, action)) {
      throw new HttpError(400, 'Unknown action');
    }
    const actor = await getActor(request, { allowIncompleteProfile: true });
    if (actor?.kind === 'teacher' && !PROFILE_SETUP_ACTIONS.has(action)) await requireTeacherAccess(actor.userId);
    const ctx = createDataContext(actor);
    const handler = dataActions[action] as (c: typeof ctx, ...a: unknown[]) => Promise<unknown>;
    const result = await handler(ctx, ...args);
    return NextResponse.json({ result: result ?? null });
  } catch (error) {
    return errorResponse(error);
  }
}
