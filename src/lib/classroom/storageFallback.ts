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
  updated_at?: string;
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

// In-memory + fresh file persistence fallback
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

export const fallbackStore = {
  // ----------------------------------------------------
  // POSTS
  // ----------------------------------------------------
  getPosts(classroomId: string): FallbackPost[] {
    const posts: FallbackPost[] = readJson(POSTS_FILE, []);
    return posts.filter((p) => p.classroom_id === classroomId);
  },
  savePost(post: FallbackPost) {
    const posts: FallbackPost[] = readJson(POSTS_FILE, []);
    const existingIdx = posts.findIndex((p) => p.id === post.id);
    if (existingIdx >= 0) {
      posts[existingIdx] = { ...posts[existingIdx], ...post };
    } else {
      posts.unshift(post);
    }
    writeJson(POSTS_FILE, posts);
    return post;
  },
  updatePost(id: string, body: string) {
    const posts: FallbackPost[] = readJson(POSTS_FILE, []);
    const idx = posts.findIndex((p) => p.id === id);
    if (idx >= 0) {
      posts[idx].body = body;
      posts[idx].updated_at = new Date().toISOString();
      writeJson(POSTS_FILE, posts);
      return posts[idx];
    }
    return null;
  },
  deletePost(id: string) {
    const posts: FallbackPost[] = readJson(POSTS_FILE, []);
    const filtered = posts.filter((p) => p.id !== id);
    writeJson(POSTS_FILE, filtered);
    return true;
  },

  // ----------------------------------------------------
  // ATTENDANCE SESSIONS
  // ----------------------------------------------------
  getAttendanceSessions(classroomId: string): FallbackAttendanceSession[] {
    const sessions: FallbackAttendanceSession[] = readJson(ATTENDANCE_FILE, []);
    return sessions.filter((s) => s.classroom_id === classroomId);
  },
  saveAttendanceSession(session: FallbackAttendanceSession) {
    const sessions: FallbackAttendanceSession[] = readJson(ATTENDANCE_FILE, []);
    const existingIdx = sessions.findIndex((s) => s.id === session.id);
    if (existingIdx >= 0) {
      sessions[existingIdx] = { ...sessions[existingIdx], ...session };
    } else {
      sessions.unshift(session);
    }
    writeJson(ATTENDANCE_FILE, sessions);
    return session;
  },
  deleteAttendanceSession(sessionId: string) {
    const sessions: FallbackAttendanceSession[] = readJson(ATTENDANCE_FILE, []);
    writeJson(ATTENDANCE_FILE, sessions.filter((s) => s.id !== sessionId));

    // Also remove associated records
    const records: FallbackAttendanceRecord[] = readJson(RECORDS_FILE, []);
    writeJson(RECORDS_FILE, records.filter((r) => r.session_id !== sessionId));
    return true;
  },

  // ----------------------------------------------------
  // ATTENDANCE RECORDS
  // ----------------------------------------------------
  getAttendanceRecords(sessionId: string): FallbackAttendanceRecord[] {
    const records: FallbackAttendanceRecord[] = readJson(RECORDS_FILE, []);
    return records.filter((r) => r.session_id === sessionId);
  },
  getStudentRecords(classroomId: string, studentId: string): FallbackAttendanceRecord[] {
    if (!studentId || !studentId.trim()) return [];
    const records: FallbackAttendanceRecord[] = readJson(RECORDS_FILE, []);
    return records.filter((r) => r.classroom_id === classroomId && r.student_id === studentId);
  },
  saveAttendanceRecord(record: FallbackAttendanceRecord) {
    if (!record.student_id || !record.student_id.trim() || !record.session_id) {
      return record;
    }
    const cleanStudentId = record.student_id.trim();
    const cleanRecord = { ...record, student_id: cleanStudentId };

    const records: FallbackAttendanceRecord[] = readJson(RECORDS_FILE, []);
    const existingIdx = records.findIndex(
      (r) => r.session_id === cleanRecord.session_id && r.student_id === cleanStudentId
    );
    if (existingIdx >= 0) {
      records[existingIdx] = { ...records[existingIdx], ...cleanRecord };
    } else {
      records.push(cleanRecord);
    }
    writeJson(RECORDS_FILE, records);
    return cleanRecord;
  },

  // ----------------------------------------------------
  // SUBMISSIONS
  // ----------------------------------------------------
  getSubmissions(assignmentId?: string): any[] {
    const submissions: any[] = readJson(SUBMISSIONS_FILE, []);
    if (!assignmentId) return submissions;
    return submissions.filter((s) => s.assignment_id === assignmentId);
  },
  saveSubmission(submission: any) {
    const submissions: any[] = readJson(SUBMISSIONS_FILE, []);
    const existingIdx = submissions.findIndex((s) => s.id === submission.id);
    if (existingIdx >= 0) {
      submissions[existingIdx] = { ...submissions[existingIdx], ...submission };
    } else {
      submissions.unshift(submission);
    }
    writeJson(SUBMISSIONS_FILE, submissions);
    return submission;
  },
  deleteSubmission(id: string) {
    const submissions: any[] = readJson(SUBMISSIONS_FILE, []);
    const filtered = submissions.filter((s) => s.id !== id);
    writeJson(SUBMISSIONS_FILE, filtered);
    return true;
  },
};
