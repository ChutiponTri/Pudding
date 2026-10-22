/**
 * Deep links into the student LIFF app, attached to every LINE message that
 * asks students to act (check in, do homework/exams, read an announcement), so
 * they can tap straight through instead of typing "#pudding link".
 *
 * The LIFF page reads these params: classId opens the classroom; code is the
 * classroom's invite code, which lets a classmate who has not joined yet send
 * a join request (classId alone is not enough); assignmentId opens that
 * assignment or its result; view=attendance opens the check-in tab.
 */
export function buildLiffUrl(options: {
  classroomId?: string | null;
  inviteCode?: string | null;
  assignmentId?: string | null;
  view?: 'attendance' | 'work' | 'timeline';
} = {}): string | null {
  const liffId = process.env.LINE_LIFF_ID || process.env.NEXT_PUBLIC_LINE_LIFF_ID;
  if (!liffId) return null;
  const params = new URLSearchParams();
  if (options.classroomId) params.set('classId', options.classroomId);
  if (options.inviteCode) params.set('code', options.inviteCode);
  if (options.assignmentId) params.set('assignmentId', options.assignmentId);
  if (options.view) params.set('view', options.view);
  const query = params.toString();
  return `https://liff.line.me/${liffId}${query ? `?${query}` : ''}`;
}

/** Appends "👉 <label>: <link>" to a LINE message when a LIFF id is configured. */
export function withLiffLink(message: string, label: string, options: Parameters<typeof buildLiffUrl>[0]): string {
  const url = buildLiffUrl(options);
  return url ? `${message}\n\n👉 ${label}\n${url}` : message;
}
