import { NextRequest, NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { findBotGroupByRef, findLinkedClassroom, webUrl } from '@/lib/line/groupLink';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/line/menu?g=<group ref>&to=classroom|create|grade|results
 * The teacher pages behind the group menu card's buttons. The card is posted
 * before the group is linked, so it carries the group's opaque ref and the
 * classroom is looked up when tapped. Only redirects: the pages themselves
 * require the teacher to be signed in. An unknown or unlinked group goes to
 * the classroom list.
 */
export async function GET(request: NextRequest) {
  const ref = request.nextUrl.searchParams.get('g');
  const to = request.nextUrl.searchParams.get('to');
  let classroomId: string | null = null;
  try {
    const supabase = createServiceSupabaseClient();
    const group = await findBotGroupByRef(supabase, ref);
    classroomId = group ? (await findLinkedClassroom(supabase, group.groupId))?.id || null : null;
  } catch (error) {
    console.error('LINE menu lookup failed:', error);
  }
  const id = classroomId ? encodeURIComponent(classroomId) : null;
  const path = !id
    ? '/classrooms'
    : to === 'create'
    ? `/assignments/new?classroomId=${id}`
    : to === 'grade'
    ? '/grading'
    : `/classrooms/${id}`;
  return NextResponse.redirect(webUrl(path), 302);
}
