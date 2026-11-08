/**
 * Browser side of student identity. The LIFF page stores the student's LINE
 * access token here after login; every request to our API then carries it in
 * a header, and the server verifies it with LINE (see lib/auth/actor.ts)
 * instead of trusting a LINE id sent in the body.
 */
export const LINE_TOKEN_HEADER = 'x-line-access-token';

/**
 * Sent with the LINE token by the teacher LIFF pages (/liff/teacher): the
 * server then looks the LINE account up as a teacher (users.teacher_line_uid)
 * instead of a student, so the web's teacher actions work from inside LINE.
 */
export const LIFF_TEACHER_HEADER = 'x-pudding-liff-teacher';

let lineAccessToken: string | null = null;
let liffTeacher = false;

export function setLineAccessToken(token: string | null | undefined) {
  lineAccessToken = token || null;
}

/** The teacher LIFF pages call this once after LINE login. */
export function setLiffTeacherMode(on: boolean) {
  liffTeacher = on;
}

/** fetch() that adds the LINE token when there is one (teacher web pages use their Clerk cookie). */
export function authFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  if (!lineAccessToken) return fetch(input, init);
  const headers = new Headers(init.headers);
  headers.set(LINE_TOKEN_HEADER, lineAccessToken);
  if (liffTeacher) headers.set(LIFF_TEACHER_HEADER, '1');
  return fetch(input, { ...init, headers });
}
