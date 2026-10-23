/**
 * How a classroom is named to students. A student sits in the same room (e.g.
 * "412") for every subject, so the subject leads and the room follows:
 * "ค31101 คณิตศาสตร์ · ห้อง 412". Shared by the student LIFF app and LINE messages.
 */
export type LabelledClassroom = {
  name?: string | null;
  course_name?: string | null;
  subject_code?: string | null;
};

/** The course code alone. subject_code defaults to "<code> <course name>", so the name is trimmed off. */
export function subjectCode(classroom: LabelledClassroom): string {
  const code = classroom.subject_code?.trim() || '';
  const name = classroom.course_name?.trim();
  if (name && code !== name && code.endsWith(name)) return code.slice(0, -name.length).trim();
  return code === name ? '' : code;
}

/** Subject name for headings, e.g. "คณิตศาสตร์". */
export function subjectName(classroom: LabelledClassroom): string {
  return classroom.course_name?.trim() || classroom.subject_code?.trim() || classroom.name?.trim() || 'รายวิชา';
}

/** Code and name, e.g. "ค31101 คณิตศาสตร์". */
export function subjectTitle(classroom: LabelledClassroom): string {
  const name = classroom.course_name?.trim();
  const code = subjectCode(classroom);
  if (name) return code ? `${code} ${name}` : name;
  return code || classroom.name?.trim() || 'รายวิชา';
}

/** "ห้อง 412" (empty when the room is already the subject's only label). */
export function roomLabel(classroom: LabelledClassroom): string {
  const room = classroom.name?.trim();
  if (!room || room === subjectTitle(classroom)) return '';
  return room.startsWith('ห้อง') ? room : `ห้อง ${room}`;
}

/** One line for messages: "ค31101 คณิตศาสตร์ · ห้อง 412". */
export function classroomTitle(classroom: LabelledClassroom): string {
  return [subjectTitle(classroom), roomLabel(classroom)].filter(Boolean).join(' · ');
}
