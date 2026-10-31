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
