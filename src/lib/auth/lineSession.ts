/**
 * Browser side of student identity. The LIFF page stores the student's LINE
 * access token here after login; every request to our API then carries it in
 * a header, and the server verifies it with LINE (see lib/auth/actor.ts)
 * instead of trusting a LINE id sent in the body.
 */
export const LINE_TOKEN_HEADER = 'x-line-access-token';

let lineAccessToken: string | null = null;

export function setLineAccessToken(token: string | null | undefined) {
  lineAccessToken = token || null;
}

/** fetch() that adds the student's LINE token when there is one (teacher pages use their Clerk cookie). */
export function authFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  if (!lineAccessToken) return fetch(input, init);
  const headers = new Headers(init.headers);
  headers.set(LINE_TOKEN_HEADER, lineAccessToken);
  return fetch(input, { ...init, headers });
}
