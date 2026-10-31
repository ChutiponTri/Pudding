'use client';

import { useSyncExternalStore } from 'react';
import type { TeacherAccess } from '@/lib/utils/teacherProfile';
import type { User } from '@/types/database';

/** The signed-in teacher's access, as last checked by TeacherProfileGate. */
export interface TeacherAccessState {
  userId: string | null;
  /** null until the first check of this page load answers. */
  access: TeacherAccess | null;
  profile: User | null;
}

const RECHECK_EVENT = 'pudding_teacher_access_recheck';
const OK_KEY = (userId: string) => `pudding_teacher_ok:${userId}`;

let state: TeacherAccessState = { userId: null, access: null, profile: null };
const listeners = new Set<() => void>();
const SERVER_STATE: TeacherAccessState = { userId: null, access: null, profile: null };

export function setTeacherAccessState(next: TeacherAccessState) {
  state = next;
  for (const listener of listeners) listener();
}

export function useTeacherAccess(): TeacherAccessState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
    () => SERVER_STATE
  );
}

/** Asks the gate to check again now (e.g. "check again" on the waiting page). */
export function recheckTeacherAccess() {
  window.dispatchEvent(new Event(RECHECK_EVENT));
}
export const TEACHER_ACCESS_RECHECK_EVENT = RECHECK_EVENT;

/**
 * Whether this browser last saw the teacher approved. Lets approved teachers
 * see pages at once instead of waiting for the check; the check still runs
 * and sends them away if that changed. The server enforces it regardless.
 */
export function wasApprovedHere(userId: string): boolean {
  try {
    return window.localStorage.getItem(OK_KEY(userId)) === '1';
  } catch {
    return false;
  }
}

export function rememberApprovedHere(userId: string, approved: boolean) {
  try {
    if (approved) window.localStorage.setItem(OK_KEY(userId), '1');
    else window.localStorage.removeItem(OK_KEY(userId));
  } catch {
    // Storage blocked (private mode): the check simply runs every time.
  }
}
