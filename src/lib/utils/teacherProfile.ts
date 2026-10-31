/** Name stored when a teacher row is created before the teacher has typed a real one. */
export const TEACHER_NAME_PLACEHOLDER = 'คุณครู';

/** Fired (same tab) after the signed-in teacher's name or institution is saved. */
export const TEACHER_PROFILE_UPDATED_EVENT = 'pudding_teacher_profile_updated';

export interface TeacherProfileFields {
  first_name?: string | null;
  last_name?: string | null;
  institution?: string | null;
}

/** A teacher may use the web app only once first name, last name and institution are all set. */
export function isTeacherProfileComplete(profile: TeacherProfileFields | null | undefined): boolean {
  if (!profile) return false;
  const first = profile.first_name?.trim() || '';
  return Boolean(first && first !== TEACHER_NAME_PLACEHOLDER && profile.last_name?.trim() && profile.institution?.trim());
}

/** The admin's decision on a teacher account; null (never decided) means pending. */
export type TeacherApproval = 'pending' | 'approved' | 'rejected';

/**
 * What a signed-in teacher may do:
 *   'incomplete' -> must fill in name and institution first (profile popup)
 *   'pending'    -> waiting for the admin to approve (/pending-approval)
 *   'rejected'   -> refused by the admin (/pending-approval)
 *   'ok'         -> may use everything
 */
export type TeacherAccess = 'incomplete' | 'pending' | 'rejected' | 'ok';

export function teacherAccessOf(
  row: (TeacherProfileFields & { teacher_approval?: string | null }) | null | undefined
): TeacherAccess {
  if (!isTeacherProfileComplete(row)) return 'incomplete';
  if (row?.teacher_approval === 'approved') return 'ok';
  if (row?.teacher_approval === 'rejected') return 'rejected';
  return 'pending';
}
