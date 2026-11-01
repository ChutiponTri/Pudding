/**
 * Last home screen of a LIFF student, kept in this phone's browser storage so
 * reopening the app shows it at once while fresh data loads.
 *
 * Guards against showing the wrong data:
 * - keyed by the LINE user id, and only read once LINE has said who is signed
 *   in (another account on the same phone never sees it);
 * - a format version (a new app version with other fields starts clean);
 * - a maximum age, after which it is ignored;
 * - it is only a placeholder: the page always fetches fresh data and replaces
 *   it, and writes come from the server response only (never from local edits);
 * - cleared on logout.
 */

import type { Assignment, Classroom, Submission } from '@/types/database';

const VERSION = 1;
const PREFIX = 'pudding_liff_home_v';
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

export interface LiffSnapshotStudent {
  id: string;
  name: string;
  first_name?: string;
  last_name?: string;
  line_uid: string;
  avatar?: string;
  student_id?: string;
  institution?: string;
  email?: string;
}

export interface LiffSnapshot {
  student: LiffSnapshotStudent;
  classrooms: Classroom[];
  assignments: Assignment[];
  submissions: Record<string, Submission>;
  gradedIds: string[];
  teacherGradedIds: string[];
}

const keyOf = (lineUid: string) => `${PREFIX}${VERSION}:${lineUid}`;

export function readLiffSnapshot(lineUid: string | null | undefined): LiffSnapshot | null {
  if (!lineUid) return null;
  try {
    const raw = localStorage.getItem(keyOf(lineUid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt: number; data: LiffSnapshot };
    if (!parsed?.data || Date.now() - parsed.savedAt > MAX_AGE_MS || parsed.data.student?.line_uid !== lineUid) {
      localStorage.removeItem(keyOf(lineUid));
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

export function writeLiffSnapshot(data: LiffSnapshot) {
  try {
    localStorage.setItem(keyOf(data.student.line_uid), JSON.stringify({ savedAt: Date.now(), data }));
  } catch {
    // Storage full or blocked: the app simply loads from the network next time.
  }
}

/** Removes every saved home screen on this phone (logout), including older format versions. */
export function clearLiffSnapshots() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(PREFIX)) localStorage.removeItem(key);
    }
  } catch {}
}
