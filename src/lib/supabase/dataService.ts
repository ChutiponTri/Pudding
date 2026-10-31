import type { RealtimeChannel } from '@supabase/supabase-js';
import {
  Assignment,
  Classroom,
  Course,
  CourseLearningIndicator,
  LearningIndicator,
  Question,
  Submission,
  SubmissionAnswer,
  SubmissionEvent,
  SubmissionOverrideStatus,
  TeacherRole,
  User,
} from '@/types/database';
import { createClient, isSupabaseConfigured } from './client';
import { authFetch } from '@/lib/auth/lineSession';
import { classroomSignalChannel, type ClassroomSignal } from '@/lib/realtime/signals';

/**
 * Browser data access. The browser never talks to the database directly: every
 * call goes to POST /api/data (or a dedicated API route), which checks who is
 * asking — the signed-in teacher, or the student verified through LINE — and
 * only then reads or writes. Live updates arrive as small server signals over
 * Supabase Realtime broadcast, so pages refetch only when something changed.
 */

/** PostgREST `in.(…)` lists live in the URL, so keep each request reasonably small. */
const SUBMISSIONS_CHUNK = 80;

let registeredInstitutionsCache: { value: string[]; expiresAt: number } | null = null;
let registeredInstitutionsRequest: Promise<string[]> | null = null;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function uniqueById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((row) => (seen.has(row.id) ? false : (seen.add(row.id), true)));
}

/** Runs one server data action as the current user; throws the server's message on failure. */
async function call<T>(action: string, ...args: unknown[]): Promise<T> {
  const res = await authFetch('/api/data', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, args }),
    cache: 'no-store',
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `Request failed (${res.status})`);
  return json.result as T;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await authFetch(url, { cache: 'no-store' });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `Request failed (${res.status})`);
  return json as T;
}

/** What roster subscribers receive. */
export type ClassroomChangeEvent = {
  type?: 'classrooms' | 'classroom_students';
  eventType?: string;
  detail?: {
    classroomId?: string;
    studentId?: string;
    student?: Partial<User>;
    autoAdmit?: boolean;
    action?: string;
    source?: string;
  };
  payload?: unknown;
};

/** Same-tab notice that the teacher's classroom list (names, terms, counts) changed. */
export const CLASSROOMS_CHANGED_EVENT = 'pudding_classrooms_changed';
function notifyClassroomsChanged(detail: { classroomId?: string; action: string }) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(CLASSROOMS_CHANGED_EVENT, { detail }));
}

/** Same-browser notice (other tabs, other components) after a local change. */
function notifyLocal(eventName: string, detail: unknown) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(eventName, { detail }));
  try {
    const bc = new BroadcastChannel('pudding_classroom_sync');
    bc.postMessage({ type: 'LOCAL_SYNC', detail });
    bc.close();
  } catch {}
}

// ------------------------------------------------------------------------------
// Signal hub: one Realtime broadcast channel per classroom, shared by every
// listener on the page (two subscriptions to one topic would conflict).
// ------------------------------------------------------------------------------
type SignalListener = { onSignal: (classroomId: string, signal: ClassroomSignal) => void; onStatus: () => void };
const signalHub = new Map<string, { channel: RealtimeChannel; live: boolean; listeners: Set<SignalListener> }>();

function joinSignalChannel(classroomId: string, listener: SignalListener) {
  let entry = signalHub.get(classroomId);
  if (!entry) {
    const supabase = createClient();
    const created: { channel: RealtimeChannel; live: boolean; listeners: Set<SignalListener> } = {
      channel: supabase.channel(classroomSignalChannel(classroomId)),
      live: false,
      listeners: new Set(),
    };
    created.channel
      .on('broadcast', { event: '*' }, (message) => {
        for (const l of created.listeners) l.onSignal(classroomId, message.payload as ClassroomSignal);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') created.live = true;
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') created.live = false;
        for (const l of created.listeners) l.onStatus();
      });
    signalHub.set(classroomId, created);
    entry = created;
  }
  entry.listeners.add(listener);
  return () => {
    const current = signalHub.get(classroomId);
    if (!current) return;
    current.listeners.delete(listener);
    if (current.listeners.size === 0) {
      signalHub.delete(classroomId);
      try {
        createClient().removeChannel(current.channel);
      } catch {}
    }
  };
}

export const dataService = {
  // ==========================================
  // USERS
  // ==========================================
  /** Creates/refreshes the LIFF student's profile. The server takes the LINE id from the verified token. */
  async syncLineStudentUser(student: {
    line_uid: string;
    name: string;
    first_name?: string;
    last_name?: string;
    avatar?: string | null;
    student_id?: string;
    institution?: string;
    email?: string | null;
  }): Promise<User> {
    return call<User>('syncLineStudentUser', student);
  },

  async updateStudentProfile(
    userId: string,
    data: { first_name: string; last_name: string; student_id: string; institution: string; email?: string | null }
  ): Promise<boolean> {
    const ok = await call<boolean>('updateStudentProfile', userId, data);
    if (ok) {
      registeredInstitutionsCache = null;
      notifyLocal('pudding_student_enrolled', { studentId: userId, student: { id: userId, role: 'student', ...data } });
    }
    return ok;
  },

  async updateTeacherProfile(userId: string, profile: { first_name: string; last_name: string; institution: string }): Promise<boolean> {
    const ok = await call<boolean>('updateTeacherProfile', userId, profile);
    registeredInstitutionsCache = null;
    return ok;
  },

  async syncClerkUser(clerkUser: {
    id: string;
    firstName?: string | null;
    lastName?: string | null;
    imageUrl?: string | null;
    email?: string | null;
    institution?: string | null;
  }): Promise<User> {
    return call<User>('syncClerkUser', clerkUser);
  },

  async getUserById(id: string): Promise<User | null> {
    try {
      return await call<User | null>('getUserById', id);
    } catch (error) {
      console.warn('getUserById error:', error);
      return null;
    }
  },

  /** Students of the signed-in teacher's own school (the server applies the school). */
  async searchStudentsByInstitution(query?: string, _institution?: string): Promise<User[]> {
    return call<User[]>('searchStudentsByInstitution', query).catch(() => []);
  },

  async searchTeachers(query?: string, institution?: string): Promise<User[]> {
    return call<User[]>('searchTeachers', query, institution).catch(() => []);
  },

  async getRegisteredInstitutions(): Promise<string[]> {
    if (registeredInstitutionsCache && registeredInstitutionsCache.expiresAt > Date.now()) return registeredInstitutionsCache.value;
    if (registeredInstitutionsRequest) return registeredInstitutionsRequest;
    registeredInstitutionsRequest = call<string[]>('getRegisteredInstitutions')
      .then((value) => {
        registeredInstitutionsCache = { value, expiresAt: Date.now() + 5 * 60 * 1000 };
        return value;
      })
      .catch(() => []);
    try {
      return await registeredInstitutionsRequest;
    } finally {
      registeredInstitutionsRequest = null;
    }
  },

  // ==============================================================================
  // COURSES (always the signed-in teacher's own)
  // ==============================================================================
  async getCourses(_teacherId?: string): Promise<Course[]> {
    return call<Course[]>('getCourses');
  },

  async getCourseById(id: string): Promise<Course | null> {
    return call<Course | null>('getCourseById', id);
  },

  async createCourse(data: Omit<Course, 'id' | 'created_at'>): Promise<Course> {
    return call<Course>('createCourse', data);
  },

  async updateCourse(id: string, data: Partial<Course>): Promise<Course | null> {
    return call<Course | null>('updateCourse', id, data);
  },

  async deleteCourse(id: string): Promise<void> {
    await call('deleteCourse', id);
  },

  /** Short, unguessable code for a co-teacher invite link (/teacher-invite?code=…). */
  async getTeacherInviteCode(courseId: string, role: 'assistant' | 'researcher'): Promise<string> {
    return call<string>('getTeacherInviteCode', courseId, role);
  },

  async getCourseInvite(code: string): Promise<{ course: Course; role: 'assistant' | 'researcher'; inviterName: string } | null> {
    return call('getCourseInvite', code);
  },

  async acceptCourseInvite(code: string, profile: { name?: string; email?: string; avatar_url?: string }): Promise<boolean> {
    return call<boolean>('acceptCourseInvite', code, profile);
  },

  /** Indicators the teacher has used in any of their courses, for quick reuse. */
  async getSavedTeacherIndicators(teacherId?: string): Promise<CourseLearningIndicator[]> {
    if (!teacherId) return [];
    return call<CourseLearningIndicator[]>('getSavedTeacherIndicators');
  },

  async updateCourseIndicators(courseId: string, indicators: CourseLearningIndicator[]): Promise<Course | null> {
    return this.updateCourse(courseId, { indicators });
  },

  // ==============================================================================
  // CLASSROOMS
  // ==============================================================================
  /** The signed-in teacher's classrooms (owned or co-taught); rosters unless `withRoster: false`. */
  async getClassrooms(_teacherId?: string, options: { withRoster?: boolean } = {}): Promise<Classroom[]> {
    return call<Classroom[]>('getClassrooms', options);
  },

  /** Classrooms the signed-in (LINE) student belongs to or has asked to join. */
  async getStudentClassrooms(_student?: { id: string; line_uid?: string }): Promise<Classroom[]> {
    return call<Classroom[]>('getStudentClassrooms');
  },

  async findClassroomByInviteCode(code: string): Promise<Classroom | null> {
    return call<Classroom | null>('findClassroomByInviteCode', code).catch(() => null);
  },

  async getClassroomRoster(classroomId: string): Promise<{ classroom: Classroom | null; students: User[]; pending_students: User[] }> {
    return call('getClassroomRoster', classroomId);
  },

  async getClassroomById(id: string): Promise<Classroom | null> {
    return (await this.getClassroomRoster(id)).classroom;
  },

  async createClassroom(data: Omit<Classroom, 'id' | 'created_at' | 'student_count' | 'students'>): Promise<Classroom> {
    const created = await call<Classroom>('createClassroom', data);
    notifyClassroomsChanged({ classroomId: created?.id, action: 'created' });
    return created;
  },

  async updateClassroom(id: string, data: Partial<Classroom>): Promise<Classroom | null> {
    const updated = await call<Classroom | null>('updateClassroom', id, data);
    notifyClassroomsChanged({ classroomId: id, action: 'updated' });
    return updated;
  },

  async deleteClassroom(id: string): Promise<void> {
    await call('deleteClassroom', id);
    notifyClassroomsChanged({ classroomId: id, action: 'deleted' });
  },

  async addStudentToClassroom(
    classroomId: string,
    studentData: Omit<User, 'id' | 'role'> & { id?: string },
    /** inviteCode: required when a student asks to join a classroom they are not in yet. */
    options: { autoAdmit?: boolean; inviteCode?: string } = {}
  ): Promise<User> {
    const student = await call<User>('addStudentToClassroom', classroomId, studentData, options);
    notifyLocal('pudding_student_enrolled', { classroomId, student, autoAdmit: student.enrollment_status === 'active' });
    return student;
  },

  async admitStudentToClassroom(classroomId: string, studentId: string): Promise<boolean> {
    const ok = await call<boolean>('admitStudentToClassroom', classroomId, studentId);
    if (ok) notifyLocal('pudding_student_admitted', { classroomId, student: { id: studentId }, action: 'admitted' });
    return ok;
  },

  async rejectStudentFromClassroom(classroomId: string, studentId: string): Promise<boolean> {
    const ok = await call<boolean>('rejectStudentFromClassroom', classroomId, studentId);
    if (ok) notifyLocal('pudding_student_rejected', { classroomId, studentId, action: 'rejected' });
    return ok;
  },

  async removeStudentFromClassroom(classroomId: string, studentId: string): Promise<void> {
    await call('removeStudentFromClassroom', classroomId, studentId);
    notifyClassroomsChanged({ classroomId, action: 'student_removed' });
  },

  /**
   * Notify when rosters change: server roster signals for the classrooms in
   * `classroomIds`, same-browser events, and a light fallback poll (ids only)
   * that runs only while the realtime socket is down. pollIntervalMs: 0 turns
   * the poll off.
   */
  subscribeToClassroomChanges(
    arg1?: string | ((event: ClassroomChangeEvent) => void),
    arg2?: (event: ClassroomChangeEvent) => void,
    options: { pollIntervalMs?: number; classroomIds?: () => string[] } = {}
  ) {
    const onUpdate = typeof arg1 === 'function' ? arg1 : arg2 || (() => {});
    if (typeof window === 'undefined') return () => {};

    const handleLocalEvent = (e: Event) => onUpdate({ eventType: 'LOCAL_SYNC', detail: (e as CustomEvent).detail });
    window.addEventListener('pudding_student_enrolled', handleLocalEvent);
    window.addEventListener('pudding_student_admitted', handleLocalEvent);
    window.addEventListener('pudding_student_rejected', handleLocalEvent);
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel('pudding_classroom_sync');
      bc.onmessage = (event) => onUpdate({ eventType: 'LOCAL_SYNC', detail: event.data?.detail || event.data });
    } catch {}

    // Server signals for the classrooms currently in scope (the list can grow).
    let live = false;
    let key = '';
    let unsubscribeSignals = () => {};
    const syncChannels = () => {
      const ids = [...new Set(options.classroomIds?.() || [])].sort();
      const nextKey = ids.join(',');
      if (nextKey === key) return;
      key = nextKey;
      unsubscribeSignals();
      unsubscribeSignals = this.subscribeToClassroomSignals(
        ids,
        (classroomId, signal) => {
          if (signal?.type !== 'roster') return;
          onUpdate({
            type: 'classroom_students',
            eventType: 'LOCAL_SYNC',
            detail: {
              classroomId,
              student: signal.student,
              autoAdmit: signal.autoAdmit,
              action: signal.action === 'admitted' || signal.action === 'rejected' ? signal.action : undefined,
              source: signal.action === 'joined' ? undefined : 'signal',
            },
          });
        },
        (isLive) => {
          live = isLive;
        }
      );
    };
    syncChannels();
    const scopeTimer = setInterval(syncChannels, 5000);

    let pollTimer: ReturnType<typeof setInterval> | null = null;
    if (options.classroomIds && options.pollIntervalMs !== 0) {
      let lastFingerprint = '';
      pollTimer = setInterval(async () => {
        if (document.visibilityState !== 'visible') return;
        if (live) {
          lastFingerprint = '';
          return;
        }
        const ids = options.classroomIds!();
        if (ids.length === 0) return;
        try {
          const fingerprint = await call<string>('rosterFingerprint', ids);
          if (lastFingerprint && fingerprint !== lastFingerprint) onUpdate({ eventType: 'LOCAL_SYNC', detail: { source: 'poll' } });
          lastFingerprint = fingerprint;
        } catch {}
      }, options.pollIntervalMs ?? 15000);
    }

    return () => {
      unsubscribeSignals();
      clearInterval(scopeTimer);
      if (pollTimer) clearInterval(pollTimer);
      window.removeEventListener('pudding_student_enrolled', handleLocalEvent);
      window.removeEventListener('pudding_student_admitted', handleLocalEvent);
      window.removeEventListener('pudding_student_rejected', handleLocalEvent);
      try {
        bc?.close();
      } catch {}
    };
  },

  /**
   * Listens for server signals about the given classrooms (submission,
   * timeline, attendance, roster, scheduled work published). `onLive(false)`
   * means a socket is down and the caller should fall back to polling.
   */
  subscribeToClassroomSignals(
    classroomIds: string[],
    onSignal: (classroomId: string, signal: ClassroomSignal) => void,
    onLive?: (live: boolean) => void
  ) {
    const ids = [...new Set(classroomIds.filter(Boolean))];
    if (!ids.length || !isSupabaseConfigured || typeof window === 'undefined') {
      onLive?.(false);
      return () => {};
    }
    const listener: SignalListener = {
      onSignal: (classroomId, signal) => {
        if (ids.includes(classroomId)) onSignal(classroomId, signal);
      },
      onStatus: () => onLive?.(ids.every((id) => signalHub.get(id)?.live)),
    };
    const leaves = ids.map((id) => joinSignalChannel(id, listener));
    listener.onStatus();
    return () => leaves.forEach((leave) => leave());
  },

  // ==============================================================================
  // LEARNING INDICATORS
  // ==============================================================================
  async getLearningIndicators(): Promise<LearningIndicator[]> {
    return call<LearningIndicator[]>('getLearningIndicators').catch(() => []);
  },

  // ==============================================================================
  // ASSIGNMENTS
  // ==============================================================================
  async getAssignmentsByClassroomIds(classroomIds: string[]): Promise<Assignment[]> {
    const ids = [...new Set(classroomIds.filter(Boolean))];
    if (ids.length === 0) return [];
    return call<Assignment[]>('getAssignmentsByClassroomIds', ids);
  },

  async getAssignmentsByClassroomId(classroomId: string): Promise<Assignment[]> {
    return this.getAssignmentsByClassroomIds([classroomId]);
  },

  async getQuestions(assignmentId: string): Promise<Question[]> {
    return call<Question[]>('getQuestions', assignmentId);
  },

  async getAssignmentById(id: string): Promise<{ assignment: Assignment | null; questions: Question[] }> {
    return call('getAssignmentById', id);
  },

  /** Creates the assignment, its questions, and its timeline post + LINE announcement (server side). */
  async createAssignment(
    assignmentData: Omit<Assignment, 'id' | 'created_at'>,
    questionsData: Omit<Question, 'id' | 'assignment_id'>[]
  ): Promise<{ assignment: Assignment; questions: Question[] }> {
    return call('createAssignment', assignmentData, questionsData);
  },

  async updateAssignment(id: string, data: Partial<Omit<Assignment, 'id' | 'created_at'>>): Promise<Assignment | null> {
    return call<Assignment | null>('updateAssignment', id, data);
  },

  /** Saves a drag in the classroom work list: positions inside one group, and the moved card's new group. */
  async reorderAssignments(
    classroomId: string,
    updates: Array<{ id: string; sort_order: number; group_name?: string | null }>
  ): Promise<boolean> {
    return call<boolean>('reorderAssignments', classroomId, updates);
  },

  /** Full edit: saves the edited questions (kept ids keep students' answers; removed ones are deleted). */
  async replaceAssignmentQuestions(
    id: string,
    questionsData: Array<Omit<Question, 'assignment_id' | 'id'> & { id?: string }>
  ): Promise<Question[]> {
    return call<Question[]>('replaceAssignmentQuestions', id, questionsData);
  },

  /** Corrects a choice / true-false answer key; submitted answers are re-scored. */
  async updateAnswerKey(
    assignmentId: string,
    questionId: string,
    idealAnswer: string
  ): Promise<{ question: Question; rescored: number; keptManual: number }> {
    return call('updateAnswerKey', assignmentId, questionId, idealAnswer);
  },

  async deleteAssignment(id: string): Promise<boolean> {
    return call<boolean>('deleteAssignment', id);
  },

  /** Releases a scheduled assignment now (the teacher reached the topic early); announced in LINE like a scheduled release. */
  async publishAssignmentNow(assignmentId: string): Promise<Assignment | null> {
    const res = await authFetch('/api/assignments/override', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ assignmentId, action: 'publish_now' }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error || `Request failed (${res.status})`);
    return (json.assignment as Assignment) || null;
  },

  async updateAssignmentDeadlineOverride(
    assignmentId: string,
    override: { status_override: SubmissionOverrideStatus; extended_until?: string }
  ): Promise<Assignment | null> {
    // Through the server, which checks the teacher and refreshes open student pages (no LINE message).
    const res = await authFetch('/api/assignments/override', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ assignmentId, ...override }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error || `Request failed (${res.status})`);
    return (json.assignment as Assignment) || null;
  },

  // ==============================================================================
  // SUBMISSIONS
  // ==============================================================================
  async submitStudentWork(payload: {
    assignment_id: string;
    student_id: string;
    student_name: string;
    student_first_name?: string;
    student_last_name?: string;
    student_avatar?: string;
    line_uid?: string;
    /** Borrowed phone: the classmate's student number; the work is saved as theirs. */
    proxy_student_number?: string;
    answers: Array<{ question_id: string; answer_text?: string; file_url?: string }>;
    antiCheating: {
      tab_switch_count: number;
      away_time_seconds: number;
      events: Array<{
        event_type: 'tab_hidden' | 'window_blur' | 'tab_visible' | 'window_focus';
        timestamp: string;
        duration_seconds: number;
        details?: string;
      }>;
    };
  }): Promise<Submission> {
    const firstName = payload.student_first_name || payload.student_name.split(' ')[0] || 'นักเรียน';
    const lastName = payload.student_last_name || payload.student_name.split(' ').slice(1).join(' ');
    // The server identifies the student from the LINE token, not from these fields.
    const res = await authFetch('/api/submissions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        assignment_id: payload.assignment_id,
        student_name: payload.student_name,
        student_first_name: firstName,
        student_last_name: lastName,
        student_avatar: payload.student_avatar,
        answers: payload.answers,
        antiCheating: payload.antiCheating,
        proxy_student_number: payload.proxy_student_number || undefined,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.submission) throw new Error(json?.error || json?.detail || `ส่งงานไม่สำเร็จ (${res.status})`);
    const submission = json.submission as Submission;
    try {
      window.dispatchEvent(new CustomEvent('pudding-submission-created', { detail: { submission } }));
      const bc = new BroadcastChannel('pudding-realtime');
      bc.postMessage({ type: 'submission_created', submission });
      bc.close();
    } catch {}
    return submission;
  },

  async getSubmissions(assignmentId: string): Promise<Submission[]> {
    return this.getSubmissionsByAssignmentIds([assignmentId]);
  },

  /**
   * Submissions for many assignments in one or a few requests. Teachers get
   * their classrooms' work (with student profiles unless includeStudents: false);
   * a student always gets only their own.
   */
  async getSubmissionsByAssignmentIds(
    assignmentIds: string[],
    options: { studentIds?: string[]; includeStudents?: boolean } = {}
  ): Promise<Submission[]> {
    const ids = [...new Set(assignmentIds.filter(Boolean))];
    if (ids.length === 0) return [];
    const extra = new URLSearchParams();
    if (options.studentIds?.length) extra.set('studentIds', [...new Set(options.studentIds.filter(Boolean))].join(','));
    if (options.includeStudents === false) extra.set('students', '0');
    const parts = await Promise.all(
      chunk(ids, SUBMISSIONS_CHUNK).map((part) => {
        const params = new URLSearchParams(extra);
        params.set('assignmentIds', part.join(','));
        return fetchJson<{ submissions: Submission[] }>(`/api/submissions?${params}`);
      })
    );
    return uniqueById(parts.flatMap((p) => p.submissions || []));
  },

  async getSubmissionEvents(submissionId: string): Promise<SubmissionEvent[]> {
    return call<SubmissionEvent[]>('getSubmissionEvents', submissionId);
  },

  async getSubmissionAnswers(submissionId: string): Promise<Record<string, SubmissionAnswer>> {
    return call<Record<string, SubmissionAnswer>>('getSubmissionAnswers', submissionId);
  },

  /** Score rows for many submissions in one request (used by the student LIFF). */
  async getAnswersForSubmissions(submissionIds: string[]): Promise<SubmissionAnswer[]> {
    const ids = [...new Set(submissionIds.filter(Boolean))];
    if (ids.length === 0) return [];
    return call<SubmissionAnswer[]>('getAnswersForSubmissions', ids);
  },

  /** Saves a grade; the server decides from the classroom whether it is official or research-only. */
  async saveTeacherGrade(
    submissionId: string,
    questionId: string,
    teacherScore: number,
    teacherComment: string,
    teacherId: string,
    teacherName: string,
    _teacherRole: TeacherRole = 'primary'
  ): Promise<void> {
    await call('saveTeacherGrade', submissionId, questionId, teacherScore, teacherComment, teacherId, teacherName);
  },

  /**
   * Records roster students who never handed in, so they can be graded (with
   * zero: an official 0 on every question). Returns the created submissions.
   */
  async recordMissingSubmissions(assignmentId: string, rosterIds: string[], zero: boolean, teacherName: string): Promise<Submission[]> {
    return call<Submission[]>('recordMissingSubmissions', assignmentId, rosterIds, zero, teacherName);
  },
};
