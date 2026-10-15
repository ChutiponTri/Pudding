import fs from 'fs';
import path from 'path';

export interface FallbackPost {
  id: string;
  classroom_id: string;
  author_id: string;
  body: string;
  activity_type: 'announcement' | 'assignment' | 'exam' | 'attendance';
  metadata?: Record<string, any>;
  created_at: string;
}

export interface FallbackAttendanceSession {
  id: string;
  classroom_id: string;
  title: string;
  starts_at: string;
  on_time_until_minutes: number;
  late_until_minutes: number;
  status: 'scheduled' | 'open' | 'closed';
  closed_at?: string | null;
  created_by: string;
  created_at: string;
}

export interface FallbackAttendanceRecord {
  id: string;
  session_id: string;
  classroom_id: string;
  student_id: string;
  status: 'on_time' | 'late' | 'absent' | 'excused';
  checked_at?: string | null;
  adjusted_at?: string | null;
  adjusted_by?: string | null;
}

// In-memory + lightweight file persistence fallback
const FALLBACK_DIR = path.resolve(process.cwd(), '.codex');
const POSTS_FILE = path.join(FALLBACK_DIR, 'fallback_posts.json');
const ATTENDANCE_FILE = path.join(FALLBACK_DIR, 'fallback_attendance.json');
const RECORDS_FILE = path.join(FALLBACK_DIR, 'fallback_records.json');
const SUBMISSIONS_FILE = path.join(FALLBACK_DIR, 'fallback_submissions.json');

function ensureDir() {
  try {
    if (!fs.existsSync(FALLBACK_DIR)) {
      fs.mkdirSync(FALLBACK_DIR, { recursive: true });
    }
  } catch {}
}

function readJson<T>(filePath: string, defaultVal: T): T {
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(data) as T;
    }
  } catch {}
  return defaultVal;
}

function writeJson(filePath: string, data: any) {
  try {
    ensureDir();
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch {}
}

let postsCache: FallbackPost[] = readJson(POSTS_FILE, []);
let attendanceSessionsCache: FallbackAttendanceSession[] = readJson(ATTENDANCE_FILE, []);
let attendanceRecordsCache: FallbackAttendanceRecord[] = readJson(RECORDS_FILE, []);
let submissionsCache: any[] = readJson(SUBMISSIONS_FILE, []);

export const fallbackStore = {
  getPosts(classroomId: string): FallbackPost[] {
    return postsCache.filter((p) => p.classroom_id === classroomId);
  },
  savePost(post: FallbackPost) {
    const existingIdx = postsCache.findIndex((p) => p.id === post.id);
    if (existingIdx >= 0) {
      postsCache[existingIdx] = post;
    } else {
      postsCache.unshift(post);
    }
    writeJson(POSTS_FILE, postsCache);
    return post;
  },
  getAttendanceSessions(classroomId: string): FallbackAttendanceSession[] {
    return attendanceSessionsCache.filter((s) => s.classroom_id === classroomId);
  },
  saveAttendanceSession(session: FallbackAttendanceSession) {
    const existingIdx = attendanceSessionsCache.findIndex((s) => s.id === session.id);
    if (existingIdx >= 0) {
      attendanceSessionsCache[existingIdx] = session;
    } else {
      attendanceSessionsCache.unshift(session);
    }
    writeJson(ATTENDANCE_FILE, attendanceSessionsCache);
    return session;
  },
  getAttendanceRecords(sessionId: string): FallbackAttendanceRecord[] {
    return attendanceRecordsCache.filter((r) => r.session_id === sessionId);
  },
  getStudentRecords(classroomId: string, studentId: string): FallbackAttendanceRecord[] {
    return attendanceRecordsCache.filter((r) => r.classroom_id === classroomId && r.student_id === studentId);
  },
  saveAttendanceRecord(record: FallbackAttendanceRecord) {
    const existingIdx = attendanceRecordsCache.findIndex(
      (r) => r.session_id === record.session_id && r.student_id === record.student_id
    );
    if (existingIdx >= 0) {
      attendanceRecordsCache[existingIdx] = { ...attendanceRecordsCache[existingIdx], ...record };
    } else {
      attendanceRecordsCache.push(record);
    }
    writeJson(RECORDS_FILE, attendanceRecordsCache);
    return record;
  },
  getSubmissions(assignmentId?: string): any[] {
    if (!assignmentId) return submissionsCache;
    return submissionsCache.filter((s) => s.assignment_id === assignmentId);
  },
  saveSubmission(submission: any) {
    const existingIdx = submissionsCache.findIndex((s) => s.id === submission.id);
    if (existingIdx >= 0) {
      submissionsCache[existingIdx] = { ...submissionsCache[existingIdx], ...submission };
    } else {
      submissionsCache.unshift(submission);
    }
    writeJson(SUBMISSIONS_FILE, submissionsCache);
    return submission;
  },
};
