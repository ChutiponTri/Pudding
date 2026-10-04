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
  TeacherGradeRecord,
  TeacherRole,
  User,
} from '@/types/database';
import {
  mockAssignments,
  mockClassrooms,
  mockCourses,
  mockLearningIndicators,
  mockQuestions,
  mockSubmissions,
  mockSubmissionAnswers,
  mockSubmissionEvents,
} from './mockData';
import { createClient, isSupabaseConfigured } from './client';

// Local storage key for persistent interactive testing when Supabase is not configured
const STORAGE_PREFIX = 'pudding_';
const LEGACY_STORAGE_PREFIX = 'omurice_';

function getStoredOr<T>(key: string, defaultValue: T): T {
  if (typeof window === 'undefined') return defaultValue;
  try {
    const item = localStorage.getItem(STORAGE_PREFIX + key) || localStorage.getItem(LEGACY_STORAGE_PREFIX + key);
    return item ? JSON.parse(item) : defaultValue;
  } catch {
    return defaultValue;
  }
}

function setStored<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

export const dataService = {
  // ==========================================
  // CLERK AUTH USER SYNC
  // ==========================================
  async syncLineStudentUser(student: {
    line_uid: string;
    name: string;
    avatar?: string | null;
    student_id?: string;
  }): Promise<User> {
    const names = student.name.trim().split(" ");
    const firstName = names[0] || "นักเรียน";
    const lastName = names.slice(1).join(" ") || "";
    const userId = student.line_uid;

    let finalStudentId: string | null = student.student_id || null;

    if (isSupabaseConfigured) {
      try {
        const supabase = createClient();
        // Check if student already exists and has a real student_id
        const { data: existingUser } = await supabase
          .from("users")
          .select("*")
          .eq("id", userId)
          .maybeSingle();

        if (existingUser && existingUser.student_id && !student.student_id) {
          finalStudentId = existingUser.student_id;
        }

        const userPayload: Record<string, any> = {
          id: userId,
          first_name: firstName,
          last_name: lastName,
          avatar_url: student.avatar || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120",
          email: `${userId.substring(0, 8)}@student.pudding.ac.th`,
          role: "student",
          line_uid: student.line_uid,
          is_line_connected: true,
          updated_at: new Date().toISOString(),
        };

        if (finalStudentId) {
          userPayload.student_id = finalStudentId;
        }

        await supabase.from("users").upsert(userPayload);
        console.log("Synced real LINE student to Supabase:", userId, firstName, "student_id:", finalStudentId);

        const returnedUser: User = {
          id: userId,
          first_name: firstName,
          last_name: lastName,
          student_id: finalStudentId || undefined,
          avatar_url: userPayload.avatar_url,
          email: userPayload.email,
          role: "student",
          line_uid: student.line_uid,
          is_line_connected: true,
        };
        setStored("line_student_" + userId, returnedUser);
        return returnedUser;
      } catch (err) {
        console.error("Error syncing LINE student to Supabase:", err);
      }
    }

    const userRecord: User = {
      id: userId,
      first_name: firstName,
      last_name: lastName,
      student_id: finalStudentId || undefined,
      avatar_url: student.avatar || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120",
      email: `${userId.substring(0, 8)}@student.pudding.ac.th`,
      role: "student",
      line_uid: student.line_uid,
      is_line_connected: true,
    };
    setStored("line_student_" + userId, userRecord);
    return userRecord;
  },

  async updateStudentId(userId: string, newStudentId: string): Promise<boolean> {
    const trimmed = newStudentId.trim();
    if (!trimmed) return false;

    if (isSupabaseConfigured) {
      try {
        const supabase = createClient();
        const { error } = await supabase
          .from("users")
          .update({
            student_id: trimmed,
            updated_at: new Date().toISOString(),
          })
          .eq("id", userId);

        if (error) {
          console.error("Supabase updateStudentId error:", error.message);
          return false;
        }

        // Also update any enrolled classrooms with updated student_id
        const { data: classrooms } = await supabase.from("classrooms").select("id, students");
        if (classrooms) {
          for (const cls of classrooms) {
            const stdList = (cls.students || []) as any[];
            let touched = false;
            const updated = stdList.map((s) => {
              if (s.id === userId || s.line_uid === userId) {
                touched = true;
                return { ...s, student_id: trimmed };
              }
              return s;
            });
            if (touched) {
              await supabase.from("classrooms").update({ students: updated }).eq("id", cls.id);
            }
          }
        }
        return true;
      } catch (err) {
        console.error("Error in updateStudentId:", err);
        return false;
      }
    }
    return true;
  },

  async syncClerkUser(clerkUser: {
    id: string;
    firstName?: string | null;
    lastName?: string | null;
    imageUrl?: string | null;
    email?: string | null;
  }): Promise<User> {
    const defaultUser: User = {
      id: clerkUser.id,
      clerk_id: clerkUser.id,
      first_name: clerkUser.firstName || "คุณครู",
      last_name: clerkUser.lastName || "",
      avatar_url: clerkUser.imageUrl || "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150",
      email: clerkUser.email || "",
      role: "teacher",
    };

    if (isSupabaseConfigured) {
      try {
        const supabase = createClient();
        const userRecord: Record<string, any> = {
          id: clerkUser.id,
          first_name: defaultUser.first_name,
          last_name: defaultUser.last_name,
          avatar_url: defaultUser.avatar_url,
          email: defaultUser.email,
          role: "teacher",
          updated_at: new Date().toISOString(),
        };

        // Try upserting with clerk_id first
        let { data, error } = await supabase.from("users").upsert({
          ...userRecord,
          clerk_id: clerkUser.id,
        }).select().single();

        // Fallback without clerk_id column if not in schema cache
        if (error && error.message.includes("clerk_id")) {
          const fallback = await supabase.from("users").upsert(userRecord).select().single();
          data = fallback.data;
          error = fallback.error;
        }

        if (error) {
          console.error("Supabase user sync error:", error.message);
        } else if (data) {
          console.log("Successfully synced Clerk user to Supabase:", data.id, data.first_name);
          return data as User;
        }
      } catch (err) {
        console.error("Error syncing Clerk user to Supabase:", err);
      }
    }

    setStored("clerk_user_" + clerkUser.id, defaultUser);
    return defaultUser;
  },
  // ==============================================================================
  // COURSES
  // ==============================================================================
  async getCourses(teacherId?: string): Promise<Course[]> {
    if (isSupabaseConfigured) {
      const supabase = createClient();
      let query = supabase.from('courses').select('*').order('created_at', { ascending: false });
      const { data, error } = await query;
      if (!error && data) {
        const all = data as Course[];
        if (teacherId) {
          return all.filter((c) => c.primary_teacher_id === teacherId || c.teachers?.some((t) => t.teacher_id === teacherId));
        }
        return all;
      }
      if (error && error.code !== 'PGRST205') {
        console.warn('Supabase getCourses error:', error.message);
      }
      return [];
    }
    const stored = getStoredOr<Course[]>('courses', []);
    if (teacherId) {
      return stored.filter((c) => c.primary_teacher_id === teacherId || c.teachers?.some((t) => t.teacher_id === teacherId));
    }
    return stored;
  },

  async getCourseById(id: string): Promise<Course | null> {
    if (isSupabaseConfigured) {
      const supabase = createClient();
      const { data, error } = await supabase.from('courses').select('*').eq('id', id).single();
      if (!error && data) return data as Course;
    }
    const courses = await this.getCourses();
    return courses.find((c) => c.id === id) || null;
  },

  async createCourse(data: Omit<Course, 'id' | 'created_at'>): Promise<Course> {
    const id = `course-${Date.now()}`;
    const newCourse: Course = {
      ...data,
      id,
      created_at: new Date().toISOString(),
    };

    if (isSupabaseConfigured) {
      const supabase = createClient();
      
      // Ensure primary teacher exists in users table before inserting to prevent foreign key errors
      if (newCourse.primary_teacher_id) {
        try {
          const { data: userExists } = await supabase
            .from("users")
            .select("id")
            .eq("id", newCourse.primary_teacher_id)
            .maybeSingle();

          if (!userExists) {
            const primaryObj = newCourse.teachers?.find((t) => t.teacher_id === newCourse.primary_teacher_id) || newCourse.teachers?.[0];
            const nameParts = (primaryObj?.name || "คุณครู").trim().split(" ");
            await supabase.from("users").upsert({
              id: newCourse.primary_teacher_id,
              first_name: nameParts[0] || "คุณครู",
              last_name: nameParts.slice(1).join(" ") || "",
              role: "teacher",
              email: primaryObj?.email || null,
              avatar_url: primaryObj?.avatar_url || null,
              updated_at: new Date().toISOString(),
            });
            console.log("Auto-created teacher record in users table:", newCourse.primary_teacher_id);
          }
        } catch (uErr) {
          console.warn("Pre-checking teacher in users table notice:", uErr);
        }
      }

      const { error } = await supabase.from('courses').insert(newCourse);
      if (error) {
        console.error('Supabase createCourse error:', error);
        throw error;
      }
    }

    const courses = getStoredOr<Course[]>('courses', []);
    const updated = [newCourse, ...courses.filter((c) => c.id !== id)];
    setStored('courses', updated);
    return newCourse;
  },

  async updateCourse(id: string, data: Partial<Course>): Promise<Course | null> {
    if (isSupabaseConfigured) {
      const supabase = createClient();
      const { error } = await supabase.from('courses').update(data).eq('id', id);
      if (error) console.error('Supabase updateCourse error:', error);
    }

    const courses = await this.getCourses();
    const index = courses.findIndex((c) => c.id === id);
    if (index === -1) return null;

    const updatedCourse = { ...courses[index], ...data };
    courses[index] = updatedCourse;
    setStored('courses', courses);
    return updatedCourse;
  },

  async deleteCourse(id: string): Promise<void> {
    if (isSupabaseConfigured) {
      const supabase = createClient();
      const { error } = await supabase.from('courses').delete().eq('id', id);
      if (error) console.error('Supabase deleteCourse error:', error);
    }

    const courses = await this.getCourses();
    const updated = courses.filter((c) => c.id !== id);
    setStored('courses', updated);
  },

  async updateCourseIndicators(courseId: string, indicators: CourseLearningIndicator[]): Promise<Course | null> {
    if (isSupabaseConfigured) {
      const supabase = createClient();
      await supabase.from('courses').update({ indicators }).eq('id', courseId);
    }

    const courses = await this.getCourses();
    const index = courses.findIndex((c) => c.id === courseId);
    if (index === -1) return null;

    courses[index].indicators = indicators;
    setStored('courses', courses);

    // Also sync flat learning indicators for questions builder
    const flatIndicators: LearningIndicator[] = indicators.map((ind) => ({
      id: ind.id,
      code: ind.code,
      title: ind.title,
      subject: courses[index].name,
      teacher_id: courses[index].primary_teacher_id,
      weight: ind.weight,
      order_index: ind.order_index,
    }));
    setStored('learning_indicators', flatIndicators);

    return courses[index];
  },

  // ==============================================================================
  // CLASSROOMS
  // ==============================================================================
  async getClassrooms(teacherId?: string): Promise<Classroom[]> {
    if (isSupabaseConfigured) {
      const supabase = createClient();
      const { data, error } = await supabase.from('classrooms').select('*').order('created_at', { ascending: false });
      if (!error && data) {
        const all = data as Classroom[];
        if (teacherId) {
          return all.filter((c) => c.teacher_id === teacherId || c.teachers?.some((t) => t.teacher_id === teacherId));
        }
        return all;
      }
      if (error && error.code !== 'PGRST205') {
        console.warn('Supabase getClassrooms error:', error.message);
      }
      return [];
    }
    const stored = getStoredOr<Classroom[]>('classrooms', []);
    if (teacherId) {
      return stored.filter((c) => c.teacher_id === teacherId || c.teachers?.some((t) => t.teacher_id === teacherId));
    }
    return stored;
  },

  async getClassroomById(id: string): Promise<Classroom | null> {
    if (isSupabaseConfigured) {
      const supabase = createClient();
      const { data, error } = await supabase.from('classrooms').select('*').eq('id', id).single();
      if (!error && data) return data as Classroom;
    }
    const classrooms = await this.getClassrooms();
    return classrooms.find((c) => c.id === id) || null;
  },

  async createClassroom(
    data: Omit<Classroom, 'id' | 'created_at' | 'student_count' | 'students'>
  ): Promise<Classroom> {
    const id = `class-${Date.now()}`;
    const codeNum = Math.floor(100 + Math.random() * 900);
    const newClassroom: Classroom = {
      ...data,
      id,
      student_count: 0,
      students: [],
      invite_code: `OMU-${codeNum}`,
      created_at: new Date().toISOString(),
    };

    if (isSupabaseConfigured) {
      const supabase = createClient();

      if (newClassroom.teacher_id) {
        try {
          const { data: userExists } = await supabase
            .from("users")
            .select("id")
            .eq("id", newClassroom.teacher_id)
            .maybeSingle();

          if (!userExists) {
            const teacherObj = newClassroom.teachers?.find((t) => t.teacher_id === newClassroom.teacher_id) || newClassroom.teachers?.[0];
            const nameParts = (teacherObj?.name || "คุณครู").trim().split(" ");
            await supabase.from("users").upsert({
              id: newClassroom.teacher_id,
              first_name: nameParts[0] || "คุณครู",
              last_name: nameParts.slice(1).join(" ") || "",
              role: "teacher",
              email: teacherObj?.email || null,
              avatar_url: teacherObj?.avatar_url || null,
              updated_at: new Date().toISOString(),
            });
          }
        } catch (uErr) {
          console.warn("Pre-checking teacher in users for classroom notice:", uErr);
        }
      }

      const { error } = await supabase.from('classrooms').insert(newClassroom);
      if (error) {
        console.error('Supabase createClassroom error:', error);
        throw error;
      }
    }

    const classrooms = getStoredOr<Classroom[]>('classrooms', []);
    const updated = [newClassroom, ...classrooms.filter((c) => c.id !== id)];
    setStored('classrooms', updated);
    return newClassroom;
  },

  async updateClassroom(id: string, data: Partial<Classroom>): Promise<Classroom | null> {
    if (isSupabaseConfigured) {
      const supabase = createClient();
      const { error } = await supabase.from('classrooms').update(data).eq('id', id);
      if (error) console.error('Supabase updateClassroom error:', error);
    }

    const classrooms = await this.getClassrooms();
    const index = classrooms.findIndex((c) => c.id === id);
    if (index === -1) return null;

    const updatedClassroom = { ...classrooms[index], ...data };
    classrooms[index] = updatedClassroom;
    setStored('classrooms', classrooms);
    return updatedClassroom;
  },

  async deleteClassroom(id: string): Promise<void> {
    if (isSupabaseConfigured) {
      const supabase = createClient();
      const { error } = await supabase.from('classrooms').delete().eq('id', id);
      if (error) console.error('Supabase deleteClassroom error:', error);
    }

    const classrooms = await this.getClassrooms();
    const updated = classrooms.filter((c) => c.id !== id);
    setStored('classrooms', updated);
  },

  async addStudentToClassroom(
    classroomId: string,
    studentData: Omit<User, "id" | "role"> & { id?: string }
  ): Promise<User> {
    const studentId = studentData.id || studentData.line_uid || `std-${Date.now()}`;
    const newStudent: User = {
      ...studentData,
      id: studentId,
      role: "student",
      is_line_connected: Boolean(studentData.line_uid),
      avatar_url:
        studentData.avatar_url ||
        `https://images.unsplash.com/photo-${1534528741775 + Math.floor(Math.random() * 100)}?w=100`,
    };

    if (isSupabaseConfigured) {
      try {
        const supabase = createClient();
        // 1. Upsert into users table
        await supabase.from("users").upsert({
          id: newStudent.id,
          first_name: newStudent.first_name,
          last_name: newStudent.last_name,
          student_id: newStudent.student_id,
          role: "student",
          email: newStudent.email,
          avatar_url: newStudent.avatar_url,
          line_uid: newStudent.line_uid || null,
          is_line_connected: Boolean(newStudent.line_uid),
          updated_at: new Date().toISOString(),
        });

        // 2. Link in classroom_students table
        await supabase.from("classroom_students").upsert({
          id: `cs_${classroomId}_${newStudent.id}`,
          classroom_id: classroomId,
          student_id: newStudent.id,
          joined_via: newStudent.line_uid ? "line_liff" : "invite_code",
        });
      } catch (err) {
        console.error("Supabase addStudentToClassroom error:", err);
      }
    }

    const classrooms = await this.getClassrooms();
    const classroom = classrooms.find((c) => c.id === classroomId);
    if (classroom) {
      const currentStudents = classroom.students || [];
      const exists = currentStudents.some((s) => s.id === newStudent.id || (s.line_uid && s.line_uid === newStudent.line_uid));
      const updatedStudents = exists
        ? currentStudents.map((s) => (s.id === newStudent.id ? newStudent : s))
        : [newStudent, ...currentStudents];
      classroom.students = updatedStudents;
      classroom.student_count = updatedStudents.length;

      if (isSupabaseConfigured) {
        try {
          const supabase = createClient();
          await supabase
            .from("classrooms")
            .update({
              student_count: updatedStudents.length,
              students: updatedStudents,
            })
            .eq("id", classroomId);
        } catch (err) {
          console.error("Error updating classroom count in Supabase:", err);
        }
      }
      setStored("classrooms", classrooms);
    }

    return newStudent;
  },

  async removeStudentFromClassroom(classroomId: string, studentId: string): Promise<void> {
    if (isSupabaseConfigured) {
      const supabase = createClient();
      await supabase
        .from('classroom_students')
        .delete()
        .match({ classroom_id: classroomId, student_id: studentId });
    }

    const classrooms = await this.getClassrooms();
    const classroom = classrooms.find((c) => c.id === classroomId);
    if (classroom && classroom.students) {
      classroom.students = classroom.students.filter((s) => s.id !== studentId);
      classroom.student_count = classroom.students.length;

      if (isSupabaseConfigured) {
        const supabase = createClient();
        await supabase
          .from('classrooms')
          .update({
            student_count: classroom.students.length,
            students: classroom.students,
          })
          .eq('id', classroomId);
      }

      setStored('classrooms', classrooms);
    }
  },

  // ==============================================================================
  // LEARNING INDICATORS
  // ==============================================================================
  async getLearningIndicators(): Promise<LearningIndicator[]> {
    if (isSupabaseConfigured) {
      const supabase = createClient();
      const { data, error } = await supabase.from('learning_indicators').select('*').order('order_index');
      if (!error && data) return data as LearningIndicator[];
    }
    return getStoredOr<LearningIndicator[]>('learning_indicators', []);
  },

  // ==============================================================================
  // ASSIGNMENTS
  // ==============================================================================
  async getAssignments(): Promise<Assignment[]> {
    if (isSupabaseConfigured) {
      const supabase = createClient();
      const { data, error } = await supabase.from('assignments').select('*').order('created_at', { ascending: false });
      if (!error && data) return data as Assignment[];
    }
    return getStoredOr<Assignment[]>('assignments', []);
  },

  async getQuestions(assignmentId: string): Promise<Question[]> {
    const { questions } = await this.getAssignmentById(assignmentId);
    return questions;
  },

  async getAssignmentById(id: string): Promise<{ assignment: Assignment | null; questions: Question[] }> {
    if (isSupabaseConfigured) {
      const supabase = createClient();
      const { data: assignData } = await supabase.from('assignments').select('*').eq('id', id).single();
      const { data: qData } = await supabase.from('questions').select('*').eq('assignment_id', id);
      if (assignData) {
        return {
          assignment: assignData as Assignment,
          questions: (qData || []) as Question[],
        };
      }
    }

    const assignments = getStoredOr<Assignment[]>('assignments', []);
    const assignment = assignments.find((a) => a.id === id) || null;
    const allQuestions = getStoredOr<Question[]>('questions', []);
    const questions = allQuestions.filter((q) => q.assignment_id === id);

    return { assignment, questions };
  },

  async createAssignment(
    assignmentData: Omit<Assignment, 'id' | 'created_at'>,
    questionsData: Omit<Question, 'id' | 'assignment_id'>[]
  ): Promise<{ assignment: Assignment; questions: Question[] }> {
    const id = `assign-${Date.now()}`;
    const newAssignment: Assignment = {
      ...assignmentData,
      id,
      status_override: assignmentData.status_override || 'auto',
      created_at: new Date().toISOString(),
    };

    const newQuestions: Question[] = questionsData.map((q, idx) => ({
      ...q,
      id: `q-${Date.now()}-${idx}`,
      assignment_id: id,
    }));

    if (isSupabaseConfigured) {
      const supabase = createClient();
      await supabase.from('assignments').insert(newAssignment);
      if (newQuestions.length > 0) {
        await supabase.from('questions').insert(newQuestions);
      }
    }

    // Always update local store
    const assignments = getStoredOr<Assignment[]>('assignments', []);
    setStored('assignments', [newAssignment, ...assignments]);

    const questions = getStoredOr<Question[]>('questions', []);
    setStored('questions', [...questions, ...newQuestions]);

    return { assignment: newAssignment, questions: newQuestions };
  },

  async updateAssignmentDeadlineOverride(
    assignmentId: string,
    override: { status_override: SubmissionOverrideStatus; extended_until?: string }
  ): Promise<Assignment | null> {
    if (isSupabaseConfigured) {
      const supabase = createClient();
      await supabase.from('assignments').update(override).eq('id', assignmentId);
    }

    const assignments = await this.getAssignments();
    const index = assignments.findIndex((a) => a.id === assignmentId);
    if (index === -1) return null;

    assignments[index] = {
      ...assignments[index],
      status_override: override.status_override,
      extended_until: override.extended_until,
    };

    setStored('assignments', assignments);
    return assignments[index];
  },

  // ==============================================================================
  // SUBMISSIONS
  // ==============================================================================
  async submitStudentWork(payload: {
    assignment_id: string;
    student_id: string;
    student_name: string;
    answers: Array<{
      question_id: string;
      answer_text?: string;
      file_url?: string;
    }>;
    antiCheating: {
      tab_switch_count: number;
      away_time_seconds: number;
      events: Array<{
        event_type: "tab_hidden" | "window_blur" | "tab_visible" | "window_focus";
        timestamp: string;
        duration_seconds: number;
        details?: string;
      }>;
    };
  }): Promise<Submission> {
    const subId = `sub-${payload.assignment_id}-${payload.student_id}`;
    const isSuspicious = payload.antiCheating.tab_switch_count >= 3 || payload.antiCheating.away_time_seconds >= 30;

    const submission: Submission = {
      id: subId,
      assignment_id: payload.assignment_id,
      student_id: payload.student_id,
      status: "submitted",
      started_at: new Date(Date.now() - (payload.antiCheating.away_time_seconds * 1000 + 120000)).toISOString(),
      submitted_at: new Date().toISOString(),
      time_spent_seconds: 120 + payload.antiCheating.away_time_seconds,
      tab_switch_count: payload.antiCheating.tab_switch_count,
      total_time_away_seconds: payload.antiCheating.away_time_seconds,
      is_flagged_suspicious: isSuspicious,
      total_score: 0,
    };

    if (isSupabaseConfigured) {
      try {
        const supabase = createClient();
        await supabase.from("submissions").upsert({
          id: submission.id,
          assignment_id: submission.assignment_id,
          student_id: submission.student_id,
          status: submission.status,
          started_at: submission.started_at,
          submitted_at: submission.submitted_at,
          time_spent_seconds: submission.time_spent_seconds,
          tab_switch_count: submission.tab_switch_count,
          total_time_away_seconds: submission.total_time_away_seconds,
          is_flagged_suspicious: submission.is_flagged_suspicious,
          total_score: submission.total_score,
        });

        for (const ans of payload.answers) {
          await supabase.from("submission_answers").upsert({
            id: `ans-${subId}-${ans.question_id}`,
            submission_id: subId,
            question_id: ans.question_id,
            text_answer: ans.answer_text || "",
            file_url: ans.file_url || null,
          });
        }

        for (let i = 0; i < payload.antiCheating.events.length; i++) {
          const evt = payload.antiCheating.events[i];
          await supabase.from("submission_events").insert({
            id: `evt-${subId}-${Date.now()}-${i}`,
            submission_id: subId,
            event_type: evt.event_type,
            away_duration_seconds: evt.duration_seconds,
            created_at: evt.timestamp,
            details: evt.details || null,
          });
        }
      } catch (err) {
        console.error("Error submitting to Supabase:", err);
      }
    }

    const submissions = getStoredOr<Submission[]>("submissions", []);
    const existingIdx = submissions.findIndex((s) => s.id === subId);
    if (existingIdx !== -1) {
      submissions[existingIdx] = submission;
    } else {
      submissions.push(submission);
    }
    setStored("submissions", submissions);

    const allAnswers = getStoredOr<Record<string, Record<string, SubmissionAnswer>>>("submission_answers", {});
    allAnswers[subId] = allAnswers[subId] || {};
    for (const ans of payload.answers) {
      allAnswers[subId][ans.question_id] = {
        id: `ans-${subId}-${ans.question_id}`,
        submission_id: subId,
        question_id: ans.question_id,
        text_answer: ans.answer_text,
        file_url: ans.file_url,
      };
    }
    setStored("submission_answers", allAnswers);

    const allEvents = getStoredOr<Record<string, SubmissionEvent[]>>("submission_events", {});
    allEvents[subId] = payload.antiCheating.events.map((evt, idx) => ({
      id: `evt-${subId}-${Date.now()}-${idx}`,
      submission_id: subId,
      event_type: evt.event_type,
      away_duration_seconds: evt.duration_seconds,
      created_at: evt.timestamp,
      details: evt.details,
    }));
    setStored("submission_events", allEvents);

    return submission;
  },

  async getAllSubmissions(): Promise<Submission[]> {
    if (isSupabaseConfigured) {
      const supabase = createClient();
      const { data, error } = await supabase.from("submissions").select("*");
      if (!error && data) return data as Submission[];
    }
    return getStoredOr<Submission[]>("submissions", []);
  },

  async getSubmissions(assignmentId: string): Promise<Submission[]> {
    if (isSupabaseConfigured) {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('submissions')
        .select('*')
        .eq('assignment_id', assignmentId);
      if (!error && data) return data as Submission[];
    }

    const submissions = getStoredOr<Submission[]>('submissions', []);
    const filtered = submissions.filter((s) => s.assignment_id === assignmentId);
    return filtered.length > 0 ? filtered : submissions.filter((s) => s.assignment_id === 'assign-001');
  },

  async getSubmissionEvents(submissionId: string): Promise<SubmissionEvent[]> {
    if (isSupabaseConfigured) {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('submission_events')
        .select('*')
        .eq('submission_id', submissionId)
        .order('created_at', { ascending: true });
      if (!error && data) return data as SubmissionEvent[];
    }

    const allEvents = getStoredOr<Record<string, SubmissionEvent[]>>('submission_events', {});
    return allEvents[submissionId] || [];
  },

  async getSubmissionAnswers(submissionId: string): Promise<Record<string, SubmissionAnswer>> {
    if (isSupabaseConfigured) {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('submission_answers')
        .select('*')
        .eq('submission_id', submissionId);
      if (!error && data) {
        const mapped: Record<string, SubmissionAnswer> = {};
        for (const ans of data) {
          mapped[ans.question_id] = ans as SubmissionAnswer;
        }
        return mapped;
      }
    }

    const allAnswers = getStoredOr<Record<string, Record<string, SubmissionAnswer>>>(
      'submission_answers',
      mockSubmissionAnswers
    );
    return allAnswers[submissionId] || {};
  },

  async saveTeacherGrade(
    submissionId: string,
    questionId: string,
    teacherScore: number,
    teacherComment: string,
    teacherId: string = 'teacher-tippanan',
    teacherName: string = 'ครูธิปนรรจ์ พรายหนู',
    teacherRole: TeacherRole = 'primary'
  ): Promise<void> {
    const isPrimary = teacherRole === 'primary';

    // Update local state
    const allAnswers = getStoredOr<Record<string, Record<string, SubmissionAnswer>>>(
      'submission_answers',
      mockSubmissionAnswers
    );
    if (!allAnswers[submissionId]) {
      allAnswers[submissionId] = {};
    }

    const existing = allAnswers[submissionId][questionId] || {
      id: `ans-${Date.now()}`,
      submission_id: submissionId,
      question_id: questionId,
    };

    const currentCoGrades = existing.co_grades || {};
    const newGradeRecord: TeacherGradeRecord = {
      teacher_id: teacherId,
      teacher_name: teacherName,
      teacher_role: teacherRole,
      score: teacherScore,
      comment: teacherComment,
      graded_at: new Date().toISOString(),
    };

    // Co-teachers grade independently, but student-facing grade renders ONLY from primary teacher
    allAnswers[submissionId][questionId] = {
      ...existing,
      teacher_score: isPrimary ? teacherScore : existing.teacher_score,
      teacher_comment: isPrimary ? teacherComment : existing.teacher_comment,
      graded_at: isPrimary ? new Date().toISOString() : existing.graded_at,
      co_grades: {
        ...currentCoGrades,
        [teacherId]: newGradeRecord,
      },
    };

    // Calculate total awarded score
    const studentAnswers = allAnswers[submissionId];
    const totalAwarded = Object.values(studentAnswers).reduce(
      (acc, ans) => acc + (ans.teacher_score ?? ans.ai_mock_score ?? 0),
      0
    );

    if (isSupabaseConfigured) {
      const supabase = createClient();
      await supabase
        .from('submission_answers')
        .upsert({
          id: existing.id || `ans-${submissionId}-${questionId}`,
          submission_id: submissionId,
          question_id: questionId,
          teacher_score: isPrimary ? teacherScore : existing.teacher_score,
          teacher_comment: isPrimary ? teacherComment : existing.teacher_comment,
          co_grades: {
            ...currentCoGrades,
            [teacherId]: newGradeRecord,
          },
          graded_at: isPrimary ? new Date().toISOString() : existing.graded_at,
        });

      await supabase
        .from('submissions')
        .update({
          total_score: Math.round(totalAwarded * 10) / 10,
        })
        .eq('id', submissionId);
    }

    setStored('submission_answers', allAnswers);

    const submissions = getStoredOr<Submission[]>('submissions', []);
    const updatedSubs = submissions.map((s) =>
      s.id === submissionId ? { ...s, total_score: Math.round(totalAwarded * 10) / 10 } : s
    );
    setStored('submissions', updatedSubs);
  },
};
