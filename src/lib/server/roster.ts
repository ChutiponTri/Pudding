import 'server-only';
import type { createServiceSupabaseClient } from '@/lib/supabase/server';

type Supabase = ReturnType<typeof createServiceSupabaseClient>;

export type RosterStudent = { id: string; first_name: string; last_name: string; student_id?: string; line_uid?: string; avatar_url?: string | null };

/**
 * The classroom's students, admitted and waiting for approval, from
 * classroom_students (the source of truth, not the classrooms.students
 * snapshot) with their users in one query; sorted by student number.
 */
export async function loadRoster(supabase: Supabase, classroomId: string) {
  const USER_COLUMNS = 'id, first_name, last_name, student_id, line_uid, avatar_url';
  const { data, error } = await supabase
    .from('classroom_students')
    .select(`status, users(${USER_COLUMNS})`)
    .eq('classroom_id', classroomId);
  let rows = (data || []) as unknown as Array<{ status: string; users: RosterStudent | RosterStudent[] | null }>;
  if (error) {
    // No foreign key PostgREST can follow: the enrolments, then their users.
    const { data: links } = await supabase.from('classroom_students').select('status, student_id').eq('classroom_id', classroomId);
    const ids = (links || []).map((link) => link.student_id as string);
    const { data: users } = ids.length ? await supabase.from('users').select(USER_COLUMNS).in('id', ids) : { data: [] };
    const byId = new Map(((users || []) as RosterStudent[]).map((user) => [user.id, user]));
    rows = (links || []).map((link) => ({ status: link.status as string, users: byId.get(link.student_id as string) || null }));
  }
  const byNumber = (a: RosterStudent, b: RosterStudent) => (a.student_id || '').localeCompare(b.student_id || '', undefined, { numeric: true }) || a.first_name.localeCompare(b.first_name, 'th');
  const pick = (status: string) =>
    rows
      .filter((row) => row.status === status)
      .map((row) => (Array.isArray(row.users) ? row.users[0] : row.users))
      .filter((user): user is RosterStudent => !!user)
      .sort(byNumber);
  return { students: pick('active'), pending: pick('pending_approval') };
}

