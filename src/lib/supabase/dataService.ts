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
    first_name?: string;
    last_name?: string;
    avatar?: string | null;
    student_id?: string;
    institution?: string;
  }): Promise<User> {
    const userId = student.line_uid;
    let firstName = student.first_name?.trim() || "";
    let lastName = student.last_name?.trim() || "";
    let finalStudentId: string | null = student.student_id?.trim() || null;
    let finalInstitution: string | null = student.institution?.trim() || null;

    if (!firstName) {
      const names = student.name.trim().split(" ");
      firstName = names[0] || "นักเรียน";
      lastName = names.slice(1).join(" ") || "";
    }

    if (isSupabaseConfigured) {
      try {
        const supabase = createClient();
        // Check if student already exists and preserve real first_name, last_name, student_id, institution
        const { data: existingUser } = await supabase
          .from("users")
          .select("*")
          .eq("id", userId)
          .maybeSingle();

        if (existingUser) {
          if (existingUser.first_name && !student.first_name) firstName = existingUser.first_name;
          if (existingUser.last_name && !student.last_name) lastName = existingUser.last_name;
          if (existingUser.student_id && !student.student_id) finalStudentId = existingUser.student_id;
          if (existingUser.institution && !student.institution) finalInstitution = existingUser.institution;
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
        if (finalInstitution) {
          userPayload.institution = finalInstitution;
        }

        await supabase.from("users").upsert(userPayload);
        console.log("Synced real LINE student to Supabase:", userId, firstName, "student_id:", finalStudentId);

        const returnedUser: User = {
          id: userId,
          first_name: firstName,
          last_name: lastName,
          student_id: finalStudentId || undefined,
          institution: finalInstitution || undefined,
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
      institution: finalInstitution || undefined,
      avatar_url: student.avatar || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120",
      email: `${userId.substring(0, 8)}@student.pudding.ac.th`,
      role: "student",
      line_uid: student.line_uid,
      is_line_connected: true,
    };
    setStored("line_student_" + userId, userRecord);
    return userRecord;
  },

  async updateStudentProfile(
    userId: string,
    data: {
      first_name: string;
      last_name: string;
      student_id: string;
      institution: string;
    }
  ): Promise<boolean> {
    const fn = data.first_name.trim();
    const ln = data.last_name.trim();
    const sid = data.student_id.trim();
    const inst = data.institution.trim();

    if (isSupabaseConfigured) {
      try {
        const supabase = createClient();
        await supabase
          .from("users")
          .update({
            first_name: fn,
            last_name: ln,
            student_id: sid,
            institution: inst,
            updated_at: new Date().toISOString(),
          })
          .eq("id", userId);

        // Also update any enrolled classrooms with updated student info
        const { data: classrooms } = await supabase.from("classrooms").select("id, students, pending_students");
        if (classrooms) {
          for (const cls of classrooms) {
            let touched = false;
            const updatedStudents = ((cls.students || []) as any[]).map((s) => {
              if (s.id === userId || s.line_uid === userId) {
                touched = true;
                return { ...s, first_name: fn, last_name: ln, student_id: sid, institution: inst };
              }
              return s;
            });
            const updatedPending = ((cls.pending_students || []) as any[]).map((s) => {
              if (s.id === userId || s.line_uid === userId) {
                touched = true;
                return { ...s, first_name: fn, last_name: ln, student_id: sid, institution: inst };
              }
              return s;
            });
            if (touched) {
              await supabase
                .from("classrooms")
                .update({ students: updatedStudents, pending_students: updatedPending })
                .eq("id", cls.id);
            }
          }
        }
      } catch (err) {
        console.error("Error in updateStudentProfile:", err);
      }
    }

    // Local storage sync
    const storedStudent = getStoredOr<User | null>("line_student_" + userId, null);
    if (storedStudent) {
      const updated = {
        ...storedStudent,
        first_name: fn,
        last_name: ln,
        student_id: sid,
        institution: inst,
      };
      setStored("line_student_" + userId, updated);
    }
    return true;
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

  async updateTeacherInstitution(userId: string, institution: string): Promise<boolean> {
    const trimmed = institution.trim();
    if (!trimmed) return false;

    if (isSupabaseConfigured) {
      try {
        const supabase = createClient();
        await supabase
          .from("users")
          .update({
            institution: trimmed,
            updated_at: new Date().toISOString(),
          })
          .eq("id", userId);
      } catch (err) {
        console.error("Error updating teacher institution:", err);
      }
    }

    const storedUser = getStoredOr<User | null>("clerk_user_" + userId, null);
    if (storedUser) {
      setStored("clerk_user_" + userId, { ...storedUser, institution: trimmed });
    }
    return true;
  },

  async syncClerkUser(clerkUser: {
    id: string;
    firstName?: string | null;
    lastName?: string | null;
    imageUrl?: string | null;
    email?: string | null;
    institution?: string | null;
  }): Promise<User> {
    const defaultUser: User = {
      id: clerkUser.id,
      clerk_id: clerkUser.id,
      first_name: clerkUser.firstName || "คุณครู",
      last_name: clerkUser.lastName || "",
      avatar_url: clerkUser.imageUrl || "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150",
      email: clerkUser.email || "",
      institution: clerkUser.institution || undefined,
      role: "teacher",
    };

    if (isSupabaseConfigured) {
      try {
        const supabase = createClient();
        const { data: existingUser } = await supabase
          .from("users")
          .select("*")
          .eq("id", clerkUser.id)
          .maybeSingle();

        const userRecord: Record<string, any> = {
          id: clerkUser.id,
          first_name: defaultUser.first_name,
          last_name: defaultUser.last_name,
          avatar_url: defaultUser.avatar_url,
          email: defaultUser.email,
          role: "teacher",
          institution: clerkUser.institution || existingUser?.institution || null,
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

    // If teachers are updated, sync to all classrooms under this course
    if (data.teachers) {
      try {
        const classrooms = await this.getClassrooms();
        const related = classrooms.filter((cls) => cls.course_id === id);
        for (const cls of related) {
          await this.updateClassroom(cls.id, { teachers: data.teachers });
        }
      } catch (err) {
        console.warn('Sync teachers to classrooms error:', err);
      }
    }

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

  async getSavedTeacherIndicators(teacherId?: string): Promise<CourseLearningIndicator[]> {
    const key = `saved_indicators_${teacherId || 'default'}`;
    const stored = getStoredOr<CourseLearningIndicator[]>(key, []);
    if (stored.length > 0) return stored;

    // Collect from existing courses as initial default if available
    const courses = await this.getCourses(teacherId);
    const collected: CourseLearningIndicator[] = [];
    const seen = new Set<string>();

    for (const c of courses) {
      for (const ind of c.indicators || []) {
        if (ind.title && !seen.has(ind.title.trim())) {
          seen.add(ind.title.trim());
          collected.push(ind);
        }
      }
    }
    if (collected.length > 0) {
      setStored(key, collected);
      return collected;
    }

    // Default indicators bank for quick selection
    const defaultBank: CourseLearningIndicator[] = [
      { id: 'lib-1', code: 'ท 1.1 ม.4/1', title: 'อ่านออกเสียงบทร้อยแก้วและบทร้อยกรองได้อย่างถูกต้อง ไพเราะ และเหมาะสมกับเรื่องที่อ่าน', weight: 0, order_index: 1 },
      { id: 'lib-2', code: 'ท 1.1 ม.4/2', title: 'ตีความ แปลความ และขยายความเรื่องที่อ่านได้อย่างมีวิจารณญาณ', weight: 0, order_index: 2 },
      { id: 'lib-3', code: 'ท 2.1 ม.4/1', title: 'เขียนสื่อสารในรูปแบบต่างๆ เช่น บรรยาย พรรณนา อธิบาย ได้ตรงตามวัตถุประสงค์', weight: 0, order_index: 3 },
      { id: 'lib-4', code: 'ท 3.1 ม.4/1', title: 'สรุปแนวคิดและแสดงความคิดเห็นจากเรื่องที่ฟังและดูอย่างมีเหตุผล', weight: 0, order_index: 4 },
      { id: 'lib-5', code: 'ค 1.1 ม.4/1', title: 'เข้าใจและใช้ความรู้เกี่ยวกับเซตและความน่าจะเป็นในการสื่อสารและแก้ปัญหา', weight: 0, order_index: 5 },
    ];
    setStored(key, defaultBank);
    return defaultBank;
  },

  async saveTeacherIndicators(newIndicators: CourseLearningIndicator[], teacherId?: string): Promise<void> {
    const key = `saved_indicators_${teacherId || 'default'}`;
    const existing = await this.getSavedTeacherIndicators(teacherId);
    const merged = [...existing];
    const seen = new Set(existing.map((e) => (e.title || '').trim().toLowerCase()));

    for (const ind of newIndicators) {
      if (ind.title && ind.title.trim() && !seen.has(ind.title.trim().toLowerCase())) {
        seen.add(ind.title.trim().toLowerCase());
        merged.push({
          id: `saved-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          code: ind.code || '',
          title: ind.title.trim(),
          weight: ind.weight || 0,
          order_index: merged.length + 1,
        });
      }
    }
    setStored(key, merged);
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

    // Save non-empty indicators to library for reuse in other courses
    const validIndicators = indicators.filter((i) => i.title && i.title.trim());
    if (validIndicators.length > 0) {
      await this.saveTeacherIndicators(validIndicators, courses[index].primary_teacher_id);
    }

    // Also sync flat learning indicators for questions builder
    const flatIndicators: LearningIndicator[] = indicators.map((ind) => ({
      id: ind.id,
      code: ind.code,
      title: ind.title,
      subject: courses[index].name,
      teacher_id: courses[index].primary_teacher_id,
      weight: ind.weight || 0,
      order_index: ind.order_index,
    }));
    setStored('learning_indicators', flatIndicators);

    return courses[index];
  },

  // ==============================================================================
  // CLASSROOMS
  // ==============================================================================
  // ==============================================================================
  // CLASSROOMS
  // ==============================================================================
  async getClassrooms(teacherId?: string): Promise<Classroom[]> {
    if (isSupabaseConfigured) {
      const supabase = createClient();
      const { data, error } = await supabase.from('classrooms').select('*').order('created_at', { ascending: false });
      if (!error && data) {
        let all = data as Classroom[];

        // Hydrate all students with real names, student IDs, and institutions from `users` table
        try {
          const { data: usersData } = await supabase.from('users').select('*');
          if (usersData && usersData.length > 0) {
            const userMap = new Map<string, User>();
            for (const u of usersData) {
              userMap.set(u.id, u as User);
              if (u.line_uid) userMap.set(u.line_uid, u as User);
            }

            all = all.map((cls) => {
              const students = (cls.students || []).map((s) => {
                const real = userMap.get(s.id) || (s.line_uid ? userMap.get(s.line_uid) : null);
                if (real) {
                  return {
                    ...s,
                    first_name: real.first_name || s.first_name,
                    last_name: real.last_name || s.last_name,
                    student_id: real.student_id || s.student_id,
                    institution: real.institution || s.institution,
                    avatar_url: real.avatar_url || s.avatar_url,
                  };
                }
                return s;
              });

              const pending_students = (cls.pending_students || []).map((s) => {
                const real = userMap.get(s.id) || (s.line_uid ? userMap.get(s.line_uid) : null);
                if (real) {
                  return {
                    ...s,
                    first_name: real.first_name || s.first_name,
                    last_name: real.last_name || s.last_name,
                    student_id: real.student_id || s.student_id,
                    institution: real.institution || s.institution,
                    avatar_url: real.avatar_url || s.avatar_url,
                  };
                }
                return s;
              });

              return {
                ...cls,
                students,
                pending_students,
                student_count: students.length,
              };
            });
          }
        } catch (uErr) {
          console.warn('Hydrating users in getClassrooms error:', uErr);
        }

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
      pending_students: [],
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
    studentData: Omit<User, "id" | "role"> & { id?: string },
    options: { autoAdmit?: boolean } = {}
  ): Promise<User> {
    const autoAdmit = options.autoAdmit ?? true;
    const studentId =
      studentData.id ||
      studentData.line_uid ||
      (studentData.student_id ? `std_${studentData.student_id.trim()}` : `std-${Date.now()}`);

    const newStudent: User = {
      ...studentData,
      id: studentId,
      role: "student",
      enrollment_status: autoAdmit ? 'active' : 'pending_approval',
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
          institution: newStudent.institution,
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
          status: autoAdmit ? "active" : "pending_approval",
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
      const currentPending = classroom.pending_students || [];

      if (autoAdmit) {
        // Direct Active Enrollment
        const exists = currentStudents.some(
          (s) =>
            s.id === newStudent.id ||
            (s.line_uid && s.line_uid === newStudent.line_uid) ||
            (s.student_id && newStudent.student_id && s.student_id.trim() === newStudent.student_id.trim())
        );
        const updatedStudents = exists
          ? currentStudents.map((s) =>
              s.id === newStudent.id ||
              (s.line_uid && s.line_uid === newStudent.line_uid) ||
              (s.student_id && newStudent.student_id && s.student_id.trim() === newStudent.student_id.trim())
                ? newStudent
                : s
            )
          : [newStudent, ...currentStudents];
        
        classroom.students = updatedStudents;
        classroom.pending_students = currentPending.filter((p) => p.id !== newStudent.id && p.line_uid !== newStudent.line_uid);
        classroom.student_count = updatedStudents.length;
      } else {
        // Pending Teacher Admission (Admit Required)
        const alreadyActive = currentStudents.some(
          (s) => s.id === newStudent.id || (s.line_uid && s.line_uid === newStudent.line_uid)
        );
        if (!alreadyActive) {
          const pendingExists = currentPending.some(
            (p) => p.id === newStudent.id || (p.line_uid && p.line_uid === newStudent.line_uid)
          );
          classroom.pending_students = pendingExists
            ? currentPending.map((p) => (p.id === newStudent.id ? newStudent : p))
            : [newStudent, ...currentPending];
        }
      }

      if (isSupabaseConfigured) {
        try {
          const supabase = createClient();
          await supabase
            .from("classrooms")
            .update({
              student_count: classroom.students?.length || 0,
              students: classroom.students || [],
              pending_students: classroom.pending_students || [],
            })
            .eq("id", classroomId);
        } catch (err) {
          console.error("Error updating classroom count in Supabase:", err);
        }
      }
      setStored("classrooms", classrooms);
    }

    // Broadcast instant event across tabs/windows
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("pudding_student_enrolled", {
          detail: { classroomId, student: newStudent, autoAdmit },
        })
      );
      try {
        const bc = new BroadcastChannel("pudding_classroom_sync");
        bc.postMessage({ type: "LOCAL_SYNC", detail: { classroomId, student: newStudent, autoAdmit } });
        bc.close();
      } catch {}
    }

    return newStudent;
  },

  async admitStudentToClassroom(classroomId: string, studentId: string): Promise<boolean> {
    const classrooms = await this.getClassrooms();
    const classroom = classrooms.find((c) => c.id === classroomId);
    if (!classroom) return false;

    const currentPending = classroom.pending_students || [];
    const studentToAdmit = currentPending.find((s) => s.id === studentId || s.line_uid === studentId);
    if (!studentToAdmit) return false;

    const remainingPending = currentPending.filter((s) => s.id !== studentId && s.line_uid !== studentId);
    const existingStudents = classroom.students || [];
    const updatedStudents = existingStudents.some((s) => s.id === studentToAdmit.id || s.line_uid === studentToAdmit.line_uid)
      ? existingStudents
      : [studentToAdmit, ...existingStudents];

    classroom.students = updatedStudents;
    classroom.pending_students = remainingPending;
    classroom.student_count = updatedStudents.length;

    if (isSupabaseConfigured) {
      try {
        const supabase = createClient();
        await supabase
          .from("classroom_students")
          .update({ status: "active" })
          .match({ classroom_id: classroomId, student_id: studentToAdmit.id });

        await supabase
          .from("classrooms")
          .update({
            students: updatedStudents,
            pending_students: remainingPending,
            student_count: updatedStudents.length,
          })
          .eq("id", classroomId);
      } catch (err) {
        console.error("admitStudentToClassroom error:", err);
      }
    }

    setStored("classrooms", classrooms);
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("pudding_student_admitted", {
          detail: { classroomId, student: studentToAdmit },
        })
      );
      try {
        const bc = new BroadcastChannel("pudding_classroom_sync");
        bc.postMessage({ type: "LOCAL_SYNC", detail: { classroomId, student: studentToAdmit, action: "admitted" } });
        bc.close();
      } catch {}
    }
    return true;
  },

  async rejectStudentFromClassroom(classroomId: string, studentId: string): Promise<boolean> {
    const classrooms = await this.getClassrooms();
    const classroom = classrooms.find((c) => c.id === classroomId);
    if (!classroom) return false;

    const remainingPending = (classroom.pending_students || []).filter((s) => s.id !== studentId && s.line_uid !== studentId);
    classroom.pending_students = remainingPending;

    if (isSupabaseConfigured) {
      try {
        const supabase = createClient();
        await supabase
          .from("classroom_students")
          .delete()
          .match({ classroom_id: classroomId, student_id: studentId });

        await supabase
          .from("classrooms")
          .update({
            pending_students: remainingPending,
          })
          .eq("id", classroomId);
      } catch (err) {
        console.error("rejectStudentFromClassroom error:", err);
      }
    }

    setStored("classrooms", classrooms);
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("pudding_student_rejected", {
          detail: { classroomId, studentId },
        })
      );
      try {
        const bc = new BroadcastChannel("pudding_classroom_sync");
        bc.postMessage({ type: "LOCAL_SYNC", detail: { classroomId, studentId, action: "rejected" } });
        bc.close();
      } catch {}
    }
    return true;
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

  async searchStudentsByInstitution(queryOrInst?: string, instOrQuery?: string): Promise<User[]> {
    let query = '';
    let institution = '';

    if (queryOrInst && instOrQuery) {
      query = queryOrInst;
      institution = instOrQuery;
    } else if (queryOrInst) {
      query = queryOrInst;
    }

    if (isSupabaseConfigured) {
      try {
        const supabase = createClient();
        let req = supabase.from('users').select('*').eq('role', 'student');
        if (institution) {
          req = req.eq('institution', institution);
        }
        const { data } = await req.limit(50);
        if (data) {
          const q = query.toLowerCase().trim();
          if (!q) return data as User[];
          return (data as User[]).filter(
            (u) =>
              (u.first_name && u.first_name.toLowerCase().includes(q)) ||
              (u.last_name && u.last_name.toLowerCase().includes(q)) ||
              (u.student_id && u.student_id.toLowerCase().includes(q)) ||
              (u.email && u.email.toLowerCase().includes(q))
          );
        }
      } catch (err) {
        console.warn('searchStudentsByInstitution error:', err);
      }
    }

    // Local / offline fallback: search from stored users & classrooms
    const users = getStoredOr<User[]>('users', []).filter((u) => u.role === 'student');
    const classrooms = getStoredOr<Classroom[]>('classrooms', []);
    const studentMap = new Map<string, User>();

    users.forEach((u) => studentMap.set(u.id, u));
    classrooms.forEach((c) => {
      (c.students || []).forEach((s) => {
        if (!studentMap.has(s.id)) {
          studentMap.set(s.id, {
            id: s.id,
            email: s.email,
            first_name: s.first_name || '',
            last_name: s.last_name || '',
            student_id: s.student_id,
            role: 'student',
            institution: s.institution,
            avatar_url: s.avatar_url,
            created_at: new Date().toISOString(),
          });
        }
      });
    });

    let results = Array.from(studentMap.values());
    if (institution) {
      results = results.filter((s) => !s.institution || s.institution === institution);
    }
    const q = query.toLowerCase().trim();
    if (q) {
      results = results.filter(
        (u) =>
          u.first_name.toLowerCase().includes(q) ||
          u.last_name.toLowerCase().includes(q) ||
          (u.student_id && u.student_id.toLowerCase().includes(q))
      );
    }
    return results;
  },

  async searchTeachers(query?: string, institution?: string): Promise<User[]> {
    if (isSupabaseConfigured) {
      try {
        const supabase = createClient();
        const { data } = await supabase.from('users').select('*').eq('role', 'teacher').limit(50);
        if (data) {
          const q = (query || '').toLowerCase().trim();
          let list = data as User[];
          if (q) {
            list = list.filter(
              (u) =>
                u.first_name.toLowerCase().includes(q) ||
                u.last_name.toLowerCase().includes(q) ||
                (u.email && u.email.toLowerCase().includes(q)) ||
                (u.institution && u.institution.toLowerCase().includes(q))
            );
          }
          if (institution) {
            list.sort((a, b) => {
              const aMatch = a.institution === institution ? 1 : 0;
              const bMatch = b.institution === institution ? 1 : 0;
              return bMatch - aMatch;
            });
          }
          return list;
        }
      } catch (err) {
        console.warn('searchTeachers error:', err);
      }
    }
    return [];
  },

  async saveResearchGrade(answerId: string, grade: TeacherGradeRecord): Promise<void> {
    if (isSupabaseConfigured) {
      try {
        const supabase = createClient();
        const { data: existing } = await supabase
          .from('submission_answers')
          .select('research_grades')
          .eq('id', answerId)
          .maybeSingle();

        const currentMap = existing?.research_grades || {};
        const updatedMap = {
          ...currentMap,
          [grade.teacher_id]: grade,
        };

        await supabase
          .from('submission_answers')
          .update({
            research_grades: updatedMap,
          })
          .eq('id', answerId);
      } catch (err) {
        console.error('saveResearchGrade error:', err);
      }
    }
  },

  async getUserById(id: string): Promise<User | null> {
    if (isSupabaseConfigured) {
      try {
        const supabase = createClient();
        const { data, error } = await supabase.from('users').select('*').eq('id', id).maybeSingle();
        if (!error && data) return data as User;
      } catch (err) {
        console.warn('getUserById error:', err);
      }
    }
    const users = getStoredOr<User[]>('users', []);
    const found = users.find((u) => u.id === id);
    if (found) return found;

    // Check stored profiles
    const storedTeacher = getStoredOr<User | null>('teacher_profile_' + id, null);
    if (storedTeacher) return storedTeacher;
    const storedStudent = getStoredOr<User | null>('line_student_' + id, null);
    if (storedStudent) return storedStudent;
    return null;
  },

  async updateUserInstitution(userId: string, institution: string): Promise<boolean> {
    const inst = institution.trim();
    if (isSupabaseConfigured) {
      try {
        const supabase = createClient();
        await supabase
          .from('users')
          .update({ institution: inst, updated_at: new Date().toISOString() })
          .eq('id', userId);
      } catch (err) {
        console.error('updateUserInstitution error:', err);
      }
    }

    const users = getStoredOr<User[]>('users', []);
    const updatedUsers = users.map((u) => (u.id === userId ? { ...u, institution: inst } : u));
    setStored('users', updatedUsers);

    const storedTeacher = getStoredOr<User | null>('teacher_profile_' + userId, null);
    if (storedTeacher) {
      setStored('teacher_profile_' + userId, { ...storedTeacher, institution: inst });
    }
    return true;
  },

  async getRegisteredInstitutions(): Promise<string[]> {
    const set = new Set<string>();
    if (isSupabaseConfigured) {
      try {
        const supabase = createClient();
        const { data } = await supabase.from('users').select('institution');
        if (data && data.length > 0) {
          data.forEach((d: { institution?: string | null }) => {
            if (d.institution && d.institution.trim()) {
              set.add(d.institution.trim());
            }
          });
        }
      } catch (e) {
        console.warn('getRegisteredInstitutions error:', e);
      }
    }

    const users = getStoredOr<User[]>('users', []);
    users.forEach((u) => {
      if (u.institution && u.institution.trim()) {
        set.add(u.institution.trim());
      }
    });

    return Array.from(set);
  },

  subscribeToClassroomChanges(
    arg1?: string | ((payload: any) => void),
    arg2?: (payload: any) => void
  ) {
    const teacherId = typeof arg1 === 'string' ? arg1 : 'all';
    const onClassroomUpdate = typeof arg1 === 'function' ? arg1 : (arg2 || (() => {}));

    let supabaseChannel: any = null;
    if (isSupabaseConfigured) {
      try {
        const supabase = createClient();
        supabaseChannel = supabase
          .channel(`teacher_${teacherId}_classrooms_${Date.now()}`)
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'classrooms' },
            (payload) => onClassroomUpdate({ type: 'classrooms', payload })
          )
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'classroom_students' },
            (payload) => onClassroomUpdate({ type: 'classroom_students', payload })
          )
          .subscribe();
      } catch (subErr) {
        console.warn('Realtime subscription error:', subErr);
      }
    }

    const handleLocalEvent = (e: any) => {
      onClassroomUpdate({ eventType: 'LOCAL_SYNC', detail: e.detail });
    };

    let bc: BroadcastChannel | null = null;
    if (typeof window !== 'undefined') {
      window.addEventListener('pudding_student_enrolled', handleLocalEvent);
      window.addEventListener('pudding_student_admitted', handleLocalEvent);
      window.addEventListener('pudding_student_rejected', handleLocalEvent);

      try {
        bc = new BroadcastChannel('pudding_classroom_sync');
        bc.onmessage = (event) => {
          onClassroomUpdate({ eventType: 'LOCAL_SYNC', detail: event.data?.detail || event.data });
        };
      } catch {}
    }

    return () => {
      if (supabaseChannel && isSupabaseConfigured) {
        try {
          const supabase = createClient();
          supabase.removeChannel(supabaseChannel);
        } catch {}
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('pudding_student_enrolled', handleLocalEvent);
        window.removeEventListener('pudding_student_admitted', handleLocalEvent);
        window.removeEventListener('pudding_student_rejected', handleLocalEvent);
      }
      if (bc) {
        try {
          bc.close();
        } catch {}
      }
    };
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

    const isOfficial = teacherRole === 'primary' || teacherRole === 'assistant';
    const isResearcher = teacherRole === 'researcher';

    // TA or Primary can award official scores; Researcher saves to research_grades without altering student score
    const currentResearchGrades = existing.research_grades || {};
    const updatedResearchGrades = isResearcher
      ? { ...currentResearchGrades, [teacherId]: newGradeRecord }
      : currentResearchGrades;

    allAnswers[submissionId][questionId] = {
      ...existing,
      teacher_score: isOfficial ? teacherScore : existing.teacher_score,
      teacher_comment: isOfficial ? teacherComment : existing.teacher_comment,
      graded_at: isOfficial ? new Date().toISOString() : existing.graded_at,
      co_grades: {
        ...currentCoGrades,
        [teacherId]: newGradeRecord,
      },
      research_grades: updatedResearchGrades,
    };

    // Calculate total awarded score from official scores (Primary or TA)
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
          teacher_score: isOfficial ? teacherScore : existing.teacher_score,
          teacher_comment: isOfficial ? teacherComment : existing.teacher_comment,
          co_grades: {
            ...currentCoGrades,
            [teacherId]: newGradeRecord,
          },
          research_grades: updatedResearchGrades,
          graded_at: isOfficial ? new Date().toISOString() : existing.graded_at,
        });

      if (isOfficial) {
        await supabase
          .from('submissions')
          .update({
            total_score: Math.round(totalAwarded * 10) / 10,
          })
          .eq('id', submissionId);
      }
    }

    setStored('submission_answers', allAnswers);

    if (isOfficial) {
      const submissions = getStoredOr<Submission[]>('submissions', []);
      const updatedSubs = submissions.map((s) =>
        s.id === submissionId ? { ...s, total_score: Math.round(totalAwarded * 10) / 10 } : s
      );
      setStored('submissions', updatedSubs);
    }
  },
};
