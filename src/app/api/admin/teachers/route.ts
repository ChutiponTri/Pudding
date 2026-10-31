import { NextRequest, NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { getAdmin } from '@/lib/server/admin';
import { rememberTeacherAccess } from '@/lib/server/teacherProfileGuard';
import { teacherAccessOf, type TeacherApproval } from '@/lib/utils/teacherProfile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const APPROVALS: TeacherApproval[] = ['pending', 'approved', 'rejected'];

/**
 * PATCH { id, approval }  approve, reject or reset a teacher account (admins only;
 * others get 404 like the admin page). The teacher's next request uses it at
 * once on this instance, within 60 s on others (the access cache).
 */
export async function PATCH(request: NextRequest) {
  const admin = await getAdmin();
  if (!admin) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { id, approval } = await request.json().catch(() => ({}));
  if (typeof id !== 'string' || !APPROVALS.includes(approval)) {
    return NextResponse.json({ error: 'id and approval (pending | approved | rejected) are required' }, { status: 400 });
  }
  const { data, error } = await createServiceSupabaseClient()
    .from('users')
    .update({ teacher_approval: approval, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('role', 'teacher')
    .select('id, first_name, last_name, institution, teacher_approval')
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!data) return NextResponse.json({ error: 'Teacher not found' }, { status: 404 });
  rememberTeacherAccess(id, teacherAccessOf(data));
  console.log(`[admin] ${admin.id} set teacher ${id} approval: ${approval}`);
  return NextResponse.json({ teacher: data });
}
