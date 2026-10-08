export type UserRole = 'teacher' | 'student' | 'admin';

export interface User {
  id: string;
  clerk_id?: string;
  line_uid?: string;
  student_id?: string;
  first_name: string;
  last_name: string;
  role: UserRole;
  avatar_url?: string;
  email?: string;
  institution?: string; // โรงเรียน / สถานศึกษา
  enrollment_status?: 'active' | 'pending_approval';
  is_line_connected?: boolean;
}

export type TeacherRole = 'primary' | 'assistant' | 'researcher';

export interface ClassroomTeacher {
  teacher_id: string;
  name: string;
  email: string;
  avatar_url?: string;
  role: TeacherRole;
  institution?: string;
}

export interface CourseLearningIndicator {
  id: string;
  course_id?: string;
  code: string; // e.g. "ท 1.1 ม.4/1", "ค 1.1 ม.4/1"
  title: string;
  subject?: string;
  weight: number; // e.g. 25 (%)
  order_index: number;
}

export interface Course {
  id: string;
  code: string; // e.g. "ท31101", "ท31102"
  name: string; // e.g. "การสื่อสารภาษาไทยร่วมสมัย", "การอ่านและการเขียนเชิงสร้างสรรค์"
  description?: string;
  academic_year: string;
  semester: number;
  year_ce: number;
  primary_teacher_id: string;
  teachers: ClassroomTeacher[];
  indicators: CourseLearningIndicator[];
  classroom_ids?: string[];
  created_at?: string;
}

export interface Classroom {
  id: string;
  course_id?: string;
  course_name?: string;
  teacher_id: string; // Primary teacher id
  teachers?: ClassroomTeacher[]; // Multi-teacher / Co-teaching list
  name: string; // Section name e.g. "ม.4/1 (แผนภาษา-การสื่อสาร)"
  academic_year: string;
  semester?: number;
  year_ce?: number;
  student_count?: number;
  subject_code?: string;
  invite_code?: string;
  students?: User[];
  pending_students?: User[]; // นักเรียนที่รอการอนุมัติ (Admit) จากคุณครู
  created_at?: string;
}

export interface LearningIndicator {
  id: string;
  teacher_id: string;
  code: string;
  title: string;
  subject?: string;
  weight?: number;
  order_index?: number;
}

export type SubmissionOverrideStatus = 'auto' | 'force_closed' | 'extended';

export interface Assignment {
  id: string;
  course_id?: string;
  classroom_id: string;
  classroom_name?: string;
  title: string;
  description?: string;
  is_exam: boolean;
  due_date: string;
  reminder_cron: string;
  total_points?: number;
  status_override?: SubmissionOverrideStatus;
  extended_until?: string;
  sample_work_url?: string;
  sample_work_title?: string;
  sample_work_description?: string;
  created_at?: string;
}

export type QuestionType = 'multiple_choice' | 'short_answer' | 'file_upload' | 'true_false';

export interface Question {
  id: string;
  assignment_id: string;
  indicator_id?: string;
  indicator?: LearningIndicator;
  type: QuestionType;
  question_text: string;
  options?: string[]; // for multiple_choice
  ideal_answer?: string;
  rubric_criteria?: string;
  max_score: number;
}

export type SubmissionStatus = 'submitted' | 'late' | 'pending';

export interface Submission {
  id: string;
  assignment_id: string;
  student_id: string;
  student?: User;
  status: SubmissionStatus;
  started_at: string;
  submitted_at?: string;
  time_spent_seconds: number;
  tab_switch_count: number;
  total_time_away_seconds: number;
  is_flagged_suspicious: boolean;
  total_score?: number;
  max_total_score?: number;
}

export interface TeacherGradeRecord {
  teacher_id: string;
  teacher_name: string;
  teacher_role: TeacherRole;
  score: number;
  comment?: string;
  graded_at: string;
}

export interface SubmissionAnswer {
  id: string;
  submission_id: string;
  question_id: string;
  question?: Question;
  text_answer?: string;
  file_url?: string;
  ai_mock_score?: number;
  ai_confidence?: number; // 0.0 - 1.0 (e.g. 0.94 = 94%)
  ai_feedback?: string;
  teacher_score?: number; // Student-facing official score (from primary teacher or TA)
  teacher_comment?: string; // Student-facing official comment
  research_grades?: Record<string, TeacherGradeRecord>; // teacher_id -> separate evaluation for Research/IRR only (not visible to students)
  co_grades?: Record<string, TeacherGradeRecord>; // legacy / co-grades
  graded_at?: string;
}

export type SubmissionEventType = 'tab_hidden' | 'window_blur' | 'tab_visible' | 'window_focus' | 'copy_attempt' | 'paste_attempt';

export interface SubmissionEvent {
  id: string;
  submission_id: string;
  event_type: SubmissionEventType;
  away_duration_seconds?: number;
  created_at: string;
  details?: string;
}
