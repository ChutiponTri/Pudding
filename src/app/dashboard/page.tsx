'use client';
import { useUser } from '@clerk/nextjs';

import React, { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { dataService } from '@/lib/supabase/dataService';
import {
  Assignment,
  Submission,
  Classroom,
  ClassroomTeacher,
  Course,
  CourseLearningIndicator,
  LearningIndicator,
  User,
} from '@/types/database';
import {
  getDefaultAcademicPeriod,
  formatAcademicPeriod,
  getAcademicYearOptions,
} from '@/lib/utils/academicYear';
import {
  Users,
  School,
  FileCheck,
  ShieldAlert,
  PlusCircle,
  ArrowRight,
  BookOpen,
  Calendar,
  Sparkles,
  Clock,
  UserPlus,
  Share2,
  Edit2,
  Trash2,
  X,
  MessageCircle,
  Mail,
  QrCode,
  Copy,
  Check,
  Send,
  ChevronDown,
  Sliders,
  ArrowUp,
  ArrowDown,
  Layers,
  Award,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  FolderKanban,
  FlaskConical,
  Search,
  GraduationCap,
  UserCheck,
  UserX,
  Building2,
  Loader2,
} from 'lucide-react';
import { notificationManager } from '@/lib/utils/notificationManager';
import { InstitutionSearchSelect } from '@/components/InstitutionSearchSelect';

export default function DashboardPage() {
  const { t, language } = useLanguage();
  const { user: clerkUser } = useUser();

  const [courses, setCourses] = useState<Course[]>([]);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [indicators, setIndicators] = useState<LearningIndicator[]>([]);
  const [allSubmissions, setAllSubmissions] = useState<Submission[]>([]);

  // Automatically sync Clerk user into Supabase users table on dashboard load
  useEffect(() => {
    if (clerkUser) {
      dataService.syncClerkUser({
        id: clerkUser.id,
        firstName: clerkUser.firstName,
        lastName: clerkUser.lastName,
        imageUrl: clerkUser.imageUrl,
        email: clerkUser.primaryEmailAddress?.emailAddress,
      }).catch((err) => console.error("Error syncing clerk user from dashboard:", err));
    }
  }, [clerkUser]);
  const [loading, setLoading] = useState(true);

  // Compute default academic period (e.g., Oct 2026 -> Semester 1 / 2026)
  const defaultPeriod = useMemo(() => getDefaultAcademicPeriod(), []);

  // Selected semester filter state (format: `${semester}_${yearCE}` or 'all')
  const [selectedSemesterKey, setSelectedSemesterKey] = useState<string>(
    `${defaultPeriod.semester}_${defaultPeriod.yearCE}`
  );

  // Teacher Institution & Profile state
  const [teacherProfile, setTeacherProfile] = useState<User | null>(null);
  const [isInstitutionModalOpen, setIsInstitutionModalOpen] = useState(false);
  const [teacherInstitutionInput, setTeacherInstitutionInput] = useState('');

  // Classroom Modals state
  const [isClassModalOpen, setIsClassModalOpen] = useState(false);
  const [editingClassroom, setEditingClassroom] = useState<Classroom | null>(null);
  const [selectedCourseForClass, setSelectedCourseForClass] = useState<string>('');
  const [classNameInput, setClassNameInput] = useState('');
  const [subjectCodeInput, setSubjectCodeInput] = useState('');
  const [formSemester, setFormSemester] = useState<number>(defaultPeriod.semester);
  const [formYearCE, setFormYearCE] = useState<number>(defaultPeriod.yearCE);

  // Student Roster & LINE Invite Modal state
  const [managingClassroom, setManagingClassroom] = useState<Classroom | null>(null);
  const [studentTab, setStudentTab] = useState<'roster' | 'pending' | 'line' | 'email'>('roster');
  const [newStudentId, setNewStudentId] = useState('');
  const [newStudentFirst, setNewStudentFirst] = useState('');
  const [newStudentLast, setNewStudentLast] = useState('');
  const [newStudentEmail, setNewStudentEmail] = useState('');
  const [studentSearchQuery, setStudentSearchQuery] = useState('');
  const [studentSearchResults, setStudentSearchResults] = useState<User[]>([]);
  const [isSearchingStudents, setIsSearchingStudents] = useState(false);
  const [emailInviteList, setEmailInviteList] = useState('');
  const [isCopied, setIsCopied] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Course-level Learning Indicators & Rubrics Settings Modal
  const [editingCourseIndicators, setEditingCourseIndicators] = useState<Course | null>(null);
  const [indicatorListDraft, setIndicatorListDraft] = useState<CourseLearningIndicator[]>([]);
  const [isIndicatorsModalOpen, setIsIndicatorsModalOpen] = useState(false);
  const [savedTeacherIndicators, setSavedTeacherIndicators] = useState<CourseLearningIndicator[]>([]);
  const [isSavedLibraryOpen, setIsSavedLibraryOpen] = useState(false);

  // Co-Teaching Setup Modal (TA vs Research Evaluator)
  const [editingCourseCoTeachers, setEditingCourseCoTeachers] = useState<Course | null>(null);
  const [isCoTeachersModalOpen, setIsCoTeachersModalOpen] = useState(false);
  const [coTeachersDraft, setCoTeachersDraft] = useState<ClassroomTeacher[]>([]);
  const [newCoTeacherRole, setNewCoTeacherRole] = useState<'assistant' | 'researcher'>('assistant');
  const [newCoTeacherFirst, setNewCoTeacherFirst] = useState('');
  const [newCoTeacherLast, setNewCoTeacherLast] = useState('');
  const [newCoTeacherEmail, setNewCoTeacherEmail] = useState('');
  const [teacherSearchQuery, setTeacherSearchQuery] = useState('');
  const [teacherSearchResults, setTeacherSearchResults] = useState<User[]>([]);
  const [isSearchingTeachers, setIsSearchingTeachers] = useState(false);
  const [inviteRoleTab, setInviteRoleTab] = useState<'assistant' | 'researcher'>('assistant');
  const [isCopiedTeacherLink, setIsCopiedTeacherLink] = useState(false);

  // Course Creation Modal state
  const [isCourseModalOpen, setIsCourseModalOpen] = useState(false);
  const [courseCodeInput, setCourseCodeInput] = useState('');
  const [courseNameInput, setCourseNameInput] = useState('');
  const [courseDescInput, setCourseDescInput] = useState('');
  const [courseSemesterInput, setCourseSemesterInput] = useState<number>(defaultPeriod.semester);
  const [courseYearInput, setCourseYearInput] = useState<number>(defaultPeriod.yearCE);
  const [courseIndicatorsDraft, setCourseIndicatorsDraft] = useState<CourseLearningIndicator[]>([]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const loadAllData = async () => {
    try {
      const teacherId = clerkUser?.id;
      const [crs, cls, as, ind, subs] = await Promise.all([
        dataService.getCourses(teacherId),
        dataService.getClassrooms(teacherId),
        dataService.getAssignments(),
        dataService.getLearningIndicators(),
        dataService.getAllSubmissions(),
      ]);

      const myClassrooms = teacherId ? cls.filter((c) => c.teacher_id === teacherId || c.teachers?.some((t) => t.teacher_id === teacherId)) : cls;
      const myClassroomIds = new Set(myClassrooms.map((c) => c.id));
      const myAssignments = teacherId ? as.filter((a) => myClassroomIds.has(a.classroom_id)) : as;
      const myAssignmentIds = new Set(myAssignments.map((a) => a.id));
      const mySubmissions = teacherId ? subs.filter((s) => myAssignmentIds.has(s.assignment_id)) : subs;

      setCourses(crs);
      setClassrooms(myClassrooms);
      setAssignments(myAssignments);
      setIndicators(ind);
      setAllSubmissions(mySubmissions);

      if (teacherId) {
        const profile = await dataService.getUserById(teacherId);
        if (profile) {
          setTeacherProfile(profile);
          if (profile.institution) {
            setTeacherInstitutionInput(profile.institution);
          }
        }
      }

      if (managingClassroom) {
        const refreshed = myClassrooms.find((c) => c.id === managingClassroom.id) || null;
        setManagingClassroom(refreshed);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAllData();
  }, [clerkUser?.id]);

  // Real-time subscription for instant dashboard updates & notifications when students join
  useEffect(() => {
    const teacherId = clerkUser?.id || 'teacher-default';
    const unsub = dataService.subscribeToClassroomChanges(teacherId, (payload: any) => {
      loadAllData();
      if (payload?.eventType === 'LOCAL_SYNC') {
        const { student, autoAdmit } = payload.detail || {};
        const studentName = student
          ? `${student.first_name || ''} ${student.last_name || ''}`.trim() || student.name || 'นักเรียน'
          : 'นักเรียน';

        if (autoAdmit === false) {
          notificationManager.add({
            title: 'คำขอเข้าห้องเรียนใหม่',
            message: `นักเรียน ${studentName} ได้สแกน QR ขอเข้าห้องเรียน (รอคุณครูอนุมัติ)`,
            type: 'admission_request',
          });
          showToast(`🔔 มีคำขอใหม่: ${studentName} ขอเข้าห้องเรียน (รออนุมัติ)`);
        } else {
          notificationManager.add({
            title: 'นักเรียนเข้าห้องเรียนสำเร็จ',
            message: `นักเรียน ${studentName} ได้เข้าห้องเรียนแล้ว`,
            type: 'student_join',
          });
          showToast(`🎉 ${studentName} ได้เข้าร่วมห้องเรียน`);
        }
      } else {
        showToast(language === 'th' ? '🔄 อัปเดตข้อมูลห้องเรียนแบบ Realtime' : 'Classroom updated in realtime');
      }
    });

    return unsub;
  }, [language]);

  // Dynamically collect all available semester options across current period, courses, and classrooms
  const availableSemesterOptions = useMemo(() => {
    const map = new Map<string, { semester: number; yearCE: number }>();
    [1, 2, 3].forEach((s) => {
      map.set(`${s}_${defaultPeriod.yearCE}`, { semester: s, yearCE: defaultPeriod.yearCE });
    });
    courses.forEach((c) => {
      if (c.semester && c.year_ce) {
        map.set(`${c.semester}_${c.year_ce}`, { semester: c.semester, yearCE: c.year_ce });
      }
    });
    classrooms.forEach((cls) => {
      if (cls.semester && cls.year_ce) {
        map.set(`${cls.semester}_${cls.year_ce}`, { semester: cls.semester, yearCE: cls.year_ce });
      }
    });
    return Array.from(map.values()).sort((a, b) => {
      if (b.yearCE !== a.yearCE) return b.yearCE - a.yearCE;
      return b.semester - a.semester;
    });
  }, [defaultPeriod.yearCE, courses, classrooms]);

  // Filter classrooms by selected semester
  const filteredClassrooms = useMemo(() => {
    if (selectedSemesterKey === 'all') return classrooms;
    const [semStr, yrStr] = selectedSemesterKey.split('_');
    const sem = Number(semStr);
    const yr = Number(yrStr);
    return classrooms.filter((cls) => {
      const parentCourse = courses.find((c) => c.id === cls.course_id);
      const clsSem = cls.semester ?? parentCourse?.semester ?? 1;
      const clsYr = cls.year_ce ?? parentCourse?.year_ce ?? defaultPeriod.yearCE;
      return clsSem === sem && clsYr === yr;
    });
  }, [classrooms, courses, selectedSemesterKey, defaultPeriod.yearCE]);

  // Filter and group courses based on selected semester
  const groupedCourses = useMemo(() => {
    if (selectedSemesterKey === 'all') {
      // In "all" mode, courses with the same course code share a single card
      const codeMap = new Map<string, Course & { sections: Classroom[]; assignments: Assignment[] }>();

      for (const course of courses) {
        const sections = classrooms.filter(
          (cls) => cls.course_id === course.id || (cls.subject_code && cls.subject_code.startsWith(course.code))
        );
        const courseAssignments = assignments.filter(
          (as) => as.course_id === course.id || sections.some((s) => s.id === as.classroom_id)
        );

        const existing = codeMap.get(course.code);
        if (!existing) {
          codeMap.set(course.code, {
            ...course,
            sections: [...sections],
            assignments: [...courseAssignments],
          });
        } else {
          // Merge sections avoiding duplicates
          const seenIds = new Set(existing.sections.map((s) => s.id));
          for (const s of sections) {
            if (!seenIds.has(s.id)) {
              existing.sections.push(s);
              seenIds.add(s.id);
            }
          }
          // Merge assignments
          const seenAsn = new Set(existing.assignments.map((a) => a.id));
          for (const a of courseAssignments) {
            if (!seenAsn.has(a.id)) {
              existing.assignments.push(a);
              seenAsn.add(a.id);
            }
          }
        }
      }

      return Array.from(codeMap.values());
    }

    // Specific semester filtered: ONLY display courses belonging to this semester and academic year!
    const [semStr, yrStr] = selectedSemesterKey.split('_');
    const sem = Number(semStr);
    const yr = Number(yrStr);

    const semesterCourses = courses.filter((c) => {
      const cSem = c.semester ?? 1;
      const cYr = c.year_ce ?? 2026;
      return cSem === sem && cYr === yr;
    });

    return semesterCourses.map((course) => {
      const sections = filteredClassrooms.filter(
        (cls) => cls.course_id === course.id || cls.subject_code?.startsWith(course.code)
      );
      const courseAssignments = assignments.filter(
        (as) => as.course_id === course.id || sections.some((s) => s.id === as.classroom_id)
      );
      return {
        ...course,
        sections,
        assignments: courseAssignments,
      };
    });
  }, [courses, classrooms, filteredClassrooms, assignments, selectedSemesterKey]);

  // Filter assignments & submissions based on filtered classrooms (for selected semester/year)
  const filteredClassroomIds = useMemo(
    () => new Set(filteredClassrooms.map((c) => c.id)),
    [filteredClassrooms]
  );

  const filteredAssignments = useMemo(() => {
    if (selectedSemesterKey === 'all') return assignments;
    return assignments.filter((a) => filteredClassroomIds.has(a.classroom_id));
  }, [assignments, filteredClassroomIds, selectedSemesterKey]);

  const filteredAssignmentIds = useMemo(
    () => new Set(filteredAssignments.map((a) => a.id)),
    [filteredAssignments]
  );

  const filteredSubmissions = useMemo(() => {
    if (selectedSemesterKey === 'all') return allSubmissions;
    return allSubmissions.filter((s) => filteredAssignmentIds.has(s.assignment_id));
  }, [allSubmissions, filteredAssignmentIds, selectedSemesterKey]);

  const totalStudents = useMemo(() => {
    return filteredClassrooms.reduce(
      (acc, c) => acc + (c.students ? c.students.length : (c.student_count || 0)),
      0
    );
  }, [filteredClassrooms]);

  const pendingGradingCount = useMemo(() => {
    return filteredSubmissions.filter(
      (s) => s.status === "submitted" || s.status === "late" || !s.total_score || s.total_score === 0
    ).length;
  }, [filteredSubmissions]);

  const suspiciousAlertCount = useMemo(() => {
    return filteredSubmissions.filter(
      (s) =>
        s.is_flagged_suspicious ||
        (s.tab_switch_count && s.tab_switch_count >= 3) ||
        (s.total_time_away_seconds && s.total_time_away_seconds >= 30)
    ).length;
  }, [filteredSubmissions]);

  // Course Creation & Deletion Handlers
  const handleOpenCreateCourseModal = () => {
    setCourseCodeInput('');
    setCourseNameInput('');
    setCourseDescInput('');
    setCourseSemesterInput(defaultPeriod.semester);
    setCourseYearInput(defaultPeriod.yearCE);
    setCourseIndicatorsDraft([]);
    setIsCourseModalOpen(true);
  };

  const handleCloneCourseToOtherSemester = (course: Course) => {
    setCourseCodeInput(course.code);
    setCourseNameInput(course.name);
    setCourseDescInput(course.description || '');
    // Next semester recommendation: if 1 -> 2, if 2 -> 3, if 3 -> 1 (next year)
    const nextSem = course.semester === 1 ? 2 : course.semester === 2 ? 3 : 1;
    const nextYr =
      course.semester === 3
        ? (course.year_ce || defaultPeriod.yearCE) + 1
        : course.year_ce || defaultPeriod.yearCE;
    setCourseSemesterInput(nextSem);
    setCourseYearInput(nextYr);
    setCourseIndicatorsDraft(course.indicators || []);
    setIsCourseModalOpen(true);
  };

  const handleSaveCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!courseCodeInput.trim() || !courseNameInput.trim()) return;

    const academicYearStr = formatAcademicPeriod(courseSemesterInput, courseYearInput, language);
    const currentTeacherId = clerkUser?.id || "teacher-default";
    const currentTeacherName = `${clerkUser?.firstName || ""} ${clerkUser?.lastName || ""}`.trim() || clerkUser?.username || "คุณครู";
    const currentTeacherEmail = clerkUser?.primaryEmailAddress?.emailAddress || "teacher@pudding.ac.th";
    const currentTeacherAvatar = clerkUser?.imageUrl || "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150";

    const initialIndicators: CourseLearningIndicator[] =
      courseIndicatorsDraft.length > 0
        ? courseIndicatorsDraft.map((ind, i) => ({
            ...ind,
            id: `ind-${Date.now()}-${i + 1}`,
            course_id: '',
            order_index: i + 1,
          }))
        : [
            {
              id: `ind-${Date.now()}-1`,
              course_id: '',
              code: `${courseCodeInput.trim().toUpperCase()} ข้อ 1`,
              title: language === 'th' ? 'การประเมินทักษะการเรียนรู้และการนำไปใช้จริง' : 'Core learning standard & practical application',
              weight: 0,
              order_index: 1,
            },
            {
              id: `ind-${Date.now()}-2`,
              course_id: '',
              code: `${courseCodeInput.trim().toUpperCase()} ข้อ 2`,
              title: language === 'th' ? 'การคิดวิเคราะห์อย่างมีวิจารณญาณและการสื่อสาร' : 'Critical analytical thinking & synthesis',
              weight: 0,
              order_index: 2,
            },
          ];

    await dataService.createCourse({
      code: courseCodeInput.trim().toUpperCase(),
      name: courseNameInput.trim(),
      description: courseDescInput.trim(),
      semester: courseSemesterInput,
      year_ce: courseYearInput,
      academic_year: academicYearStr,
      primary_teacher_id: currentTeacherId,
      teachers: [
        {
          teacher_id: currentTeacherId,
          name: `${currentTeacherName} (Primary Owner)`,
          email: currentTeacherEmail,
          avatar_url: currentTeacherAvatar,
          role: 'primary',
        },
      ],
      indicators: initialIndicators,
      classroom_ids: [],
    });

    showToast(language === 'th' ? `สร้างรายวิชา ${courseCodeInput.trim()} สำเร็จ` : `Course ${courseCodeInput.trim()} created`);
    setIsCourseModalOpen(false);
    setCourseIndicatorsDraft([]);
    await loadAllData();
  };

  const handleDeleteCourse = async (course: Course) => {
    const confirmMsg = language === 'th'
      ? `คุณต้องการลบรายวิชา "${course.code} ${course.name}" ใช่หรือไม่?\n(ข้อมูลห้องเรียนและการบ้านที่สังกัดวิชานี้ทั้งหมดจะถูกลบด้วย)`
      : `Are you sure you want to delete course "${course.code} ${course.name}"?`;
    if (confirm(confirmMsg)) {
      await dataService.deleteCourse(course.id);
      showToast(language === 'th' ? `ลบรายวิชา ${course.code} เรียบร้อยแล้ว` : `Course ${course.code} deleted`);
      await loadAllData();
    }
  };

  // Open Create Classroom Modal
  const handleOpenCreateClassModal = (targetCourse?: Course | string) => {
    setEditingClassroom(null);
    setClassNameInput('');

    if (targetCourse) {
      // Opened from Course Card: pre-fill with that course and that course's semester
      const courseObj = typeof targetCourse === 'string'
        ? courses.find((c) => c.id === targetCourse)
        : targetCourse;
      setSelectedCourseForClass(courseObj?.id || '');
      setSubjectCodeInput(courseObj ? `${courseObj.code} ${courseObj.name}` : '');
      setFormSemester(courseObj?.semester || defaultPeriod.semester);
      setFormYearCE(courseObj?.year_ce || defaultPeriod.yearCE);
    } else {
      // Opened from top group: unselected by default, system requires teacher to choose
      setSelectedCourseForClass('');
      setSubjectCodeInput('');
      setFormSemester(defaultPeriod.semester);
      setFormYearCE(defaultPeriod.yearCE);
    }

    setIsClassModalOpen(true);
  };

  // Open Edit Classroom Modal
  const handleOpenEditClassModal = (cls: Classroom) => {
    setEditingClassroom(cls);
    setSelectedCourseForClass(cls.course_id || courses[0]?.id || '');
    setClassNameInput(cls.name);
    setSubjectCodeInput(cls.subject_code || '');
    setFormSemester(cls.semester || defaultPeriod.semester);
    setFormYearCE(cls.year_ce || defaultPeriod.yearCE);
    setIsClassModalOpen(true);
  };

  // Save Classroom (Create or Edit)
  const handleSaveClassroom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCourseForClass) {
      alert(language === 'th' ? 'กรุณาเลือกรายวิชาสำหรับห้องเรียนนี้ก่อนบันทึก' : 'Please select a course for this classroom');
      return;
    }
    if (!classNameInput.trim()) return;

    const academicYearStr = formatAcademicPeriod(formSemester, formYearCE, language);
    const parentCourse = courses.find((c) => c.id === selectedCourseForClass);

    if (editingClassroom) {
      await dataService.updateClassroom(editingClassroom.id, {
        course_id: selectedCourseForClass,
        course_name: parentCourse?.name,
        name: classNameInput.trim(),
        subject_code: subjectCodeInput.trim() || `${parentCourse?.code} ${parentCourse?.name}`,
        semester: formSemester,
        year_ce: formYearCE,
        academic_year: academicYearStr,
      });
      showToast(language === 'th' ? 'แก้ไขห้องเรียนเรียบร้อย' : 'Classroom updated');
    } else {
      const currentTeacherId = clerkUser?.id || "teacher-default";
      const currentTeacherName = `${clerkUser?.firstName || ""} ${clerkUser?.lastName || ""}`.trim() || clerkUser?.username || "คุณครู";
      await dataService.createClassroom({
        course_id: selectedCourseForClass,
        course_name: parentCourse?.name,
        teacher_id: currentTeacherId,
        teachers: parentCourse?.teachers?.length ? parentCourse.teachers : [
          {
            teacher_id: currentTeacherId,
            name: currentTeacherName,
            email: clerkUser?.primaryEmailAddress?.emailAddress || "teacher@pudding.ac.th",
            role: "primary",
          }
        ],
        name: classNameInput.trim(),
        subject_code: subjectCodeInput.trim() || `${parentCourse?.code} ${parentCourse?.name}`,
        semester: formSemester,
        year_ce: formYearCE,
        academic_year: academicYearStr,
      });
      showToast(language === 'th' ? 'สร้างห้องเรียนใหม่สำเร็จ' : 'New classroom created');
    }

    setIsClassModalOpen(false);
    await loadAllData();
  };

  // Delete Classroom
  const handleDeleteClassroom = async (cls: Classroom) => {
    if (confirm(t('classroom_mgmt.delete_confirm'))) {
      await dataService.deleteClassroom(cls.id);
      showToast(language === 'th' ? 'ลบห้องเรียนเรียบร้อย' : 'Classroom deleted');
      if (managingClassroom?.id === cls.id) {
        setManagingClassroom(null);
      }
      await loadAllData();
    }
  };

  // Student management actions
  const handleAddStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!managingClassroom || !newStudentFirst.trim() || !newStudentLast.trim()) return;

    const sid = newStudentId.trim();
    const fallbackEmail = sid
      ? `${sid}@student.pudding.ac.th`
      : `${newStudentFirst.toLowerCase()}@student.pudding.ac.th`;

    await dataService.addStudentToClassroom(
      managingClassroom.id,
      {
        student_id: sid || undefined,
        first_name: newStudentFirst.trim(),
        last_name: newStudentLast.trim(),
        email: newStudentEmail.trim() || fallbackEmail,
        institution: teacherProfile?.institution,
      },
      { autoAdmit: true }
    );

    setNewStudentFirst('');
    setNewStudentLast('');
    setNewStudentId('');
    setNewStudentEmail('');
    showToast(language === 'th' ? 'เพิ่มนักเรียนเข้าห้องเรียนสำเร็จ' : 'Student added successfully');
    await loadAllData();
  };

  const handleRemoveStudent = async (studentId: string) => {
    if (!managingClassroom) return;
    if (confirm(t('classroom_mgmt.remove_student_confirm'))) {
      await dataService.removeStudentFromClassroom(managingClassroom.id, studentId);
      showToast(language === 'th' ? 'นำนักเรียนออกจากห้องแล้ว' : 'Student removed');
      await loadAllData();
    }
  };

  // Admit student join request
  const handleAdmitStudent = async (studentId: string) => {
    if (!managingClassroom) return;
    try {
      await dataService.admitStudentToClassroom(managingClassroom.id, studentId);
      showToast(language === 'th' ? 'อนุมัตินักเรียนเข้าห้องเรียนเรียบร้อย' : 'Student admitted successfully');
      await loadAllData();
    } catch (err) {
      console.error(err);
      showToast('เกิดข้อผิดพลาดในการอนุมัติ');
    }
  };

  // Reject student join request
  const handleRejectStudent = async (studentId: string) => {
    if (!managingClassroom) return;
    if (confirm(language === 'th' ? 'คุณต้องการปฏิเสธคำขอเข้าห้องเรียนนี้ใช่หรือไม่?' : 'Reject this join request?')) {
      try {
        await dataService.rejectStudentFromClassroom(managingClassroom.id, studentId);
        showToast(language === 'th' ? 'ปฏิเสธคำขอเข้าห้องเรียนแล้ว' : 'Student request rejected');
        await loadAllData();
      } catch (err) {
        console.error(err);
        showToast('เกิดข้อผิดพลาดในการปฏิเสธคำขอ');
      }
    }
  };

  // Quick search registered students from same school
  const handleSearchStudents = async (q: string) => {
    setStudentSearchQuery(q);
    if (!q.trim()) {
      setStudentSearchResults([]);
      return;
    }
    setIsSearchingStudents(true);
    try {
      const res = await dataService.searchStudentsByInstitution(q, teacherProfile?.institution);
      setStudentSearchResults(res);
    } catch (e) {
      console.error(e);
    } finally {
      setIsSearchingStudents(false);
    }
  };

  const handleSelectFoundStudent = async (std: User) => {
    if (!managingClassroom) return;
    await dataService.addStudentToClassroom(
      managingClassroom.id,
      {
        id: std.id,
        first_name: std.first_name,
        last_name: std.last_name,
        student_id: std.student_id,
        email: std.email,
        avatar_url: std.avatar_url,
        institution: std.institution || teacherProfile?.institution,
      },
      { autoAdmit: true }
    );
    showToast(language === 'th' ? `เพิ่ม ${std.first_name} ${std.last_name} สำเร็จ` : 'Student added');
    setStudentSearchQuery('');
    setStudentSearchResults([]);
    await loadAllData();
  };

  // Teacher institution saving handler
  const handleSaveTeacherInstitution = async (inst: string) => {
    if (!clerkUser?.id) return;
    try {
      await dataService.updateTeacherInstitution(clerkUser.id, inst);
      if (teacherProfile) {
        setTeacherProfile({ ...teacherProfile, institution: inst });
      }
      showToast(language === 'th' ? 'บันทึกสถานศึกษาเรียบร้อย' : 'Institution updated');
      setIsInstitutionModalOpen(false);
    } catch (e) {
      console.error(e);
      showToast('บันทึกสถานศึกษาไม่สำเร็จ');
    }
  };

  const getRealLiffUrl = (cls: Classroom) => {
    const liffId = process.env.NEXT_PUBLIC_LINE_LIFF_ID || '2011818142-BznwnWyj';
    return `https://liff.line.me/${liffId}?classId=${cls.id}&code=${cls.invite_code || ''}`;
  };

  const getWebInviteUrl = (cls: Classroom) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}/liff?classId=${cls.id}&code=${cls.invite_code || ''}`;
  };

  const handleCopyLiff = (cls: Classroom) => {
    navigator.clipboard.writeText(getRealLiffUrl(cls));
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  // Open Learning Indicators Modal
  const handleOpenIndicatorsModal = async (course: Course) => {
    setEditingCourseIndicators(course);
    setIndicatorListDraft(course.indicators || []);
    setIsIndicatorsModalOpen(true);
    const saved = await dataService.getSavedTeacherIndicators(clerkUser?.id);
    setSavedTeacherIndicators(saved);
  };

  // Indicator reordering & item management
  const handleMoveIndicator = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= indicatorListDraft.length) return;

    const copy = [...indicatorListDraft];
    const temp = copy[index];
    copy[index] = copy[targetIndex];
    copy[targetIndex] = temp;

    const reordered = copy.map((ind, i) => ({ ...ind, order_index: i + 1 }));
    setIndicatorListDraft(reordered);
  };

  const handleAddIndicatorDraft = () => {
    const nextNum = indicatorListDraft.length + 1;
    const newInd: CourseLearningIndicator = {
      id: `ind-${Date.now()}`,
      course_id: editingCourseIndicators?.id,
      code: '', // Blank by default, no mock sentence!
      title: '', // Blank by default, no mock sentence!
      weight: 0,
      order_index: nextNum,
    };
    setIndicatorListDraft([...indicatorListDraft, newInd]);
  };

  const handleAddFromSavedLibrary = (savedInd: CourseLearningIndicator) => {
    const nextNum = indicatorListDraft.length + 1;
    const newInd: CourseLearningIndicator = {
      id: `ind-${Date.now()}-${nextNum}`,
      course_id: editingCourseIndicators?.id,
      code: savedInd.code || '',
      title: savedInd.title,
      weight: 0,
      order_index: nextNum,
    };
    setIndicatorListDraft([...indicatorListDraft, newInd]);
    showToast(language === 'th' ? 'เพิ่มตัวชี้วัดจากคลังสำเร็จ' : 'Added indicator from library');
  };

  const handleDeleteIndicatorDraft = (index: number) => {
    setIndicatorListDraft(indicatorListDraft.filter((_, i) => i !== index));
  };

  const handleSaveIndicators = async () => {
    if (!editingCourseIndicators) return;
    await dataService.updateCourseIndicators(editingCourseIndicators.id, indicatorListDraft);
    showToast(
      language === 'th' ? 'บันทึกตัวชี้วัดเรียบร้อยแล้ว' : 'Course indicators saved successfully'
    );
    setIsIndicatorsModalOpen(false);
    await loadAllData();
  };

  // Co-Teachers Setup (TA vs Research Grader)
  const handleOpenCoTeachersModal = (course: Course) => {
    setEditingCourseCoTeachers(course);
    setCoTeachersDraft(course.teachers || []);
    setNewCoTeacherRole('assistant');
    setNewCoTeacherFirst('');
    setNewCoTeacherLast('');
    setNewCoTeacherEmail('');
    setTeacherSearchQuery('');
    setTeacherSearchResults([]);
    setIsCopiedTeacherLink(false);
    setIsCoTeachersModalOpen(true);
  };

  const handleSearchTeachers = async (q: string) => {
    setTeacherSearchQuery(q);
    if (!q.trim()) {
      setTeacherSearchResults([]);
      return;
    }
    setIsSearchingTeachers(true);
    try {
      const instFilter = newCoTeacherRole === 'assistant' ? teacherProfile?.institution : undefined;
      const res = await dataService.searchTeachers(q, instFilter);
      setTeacherSearchResults(res);
    } catch (e) {
      console.error(e);
    } finally {
      setIsSearchingTeachers(false);
    }
  };

  const handleSelectFoundTeacher = (tchr: User) => {
    const fullName = `${tchr.first_name || ''} ${tchr.last_name || ''}`.trim() || tchr.name || 'ครูผู้สอน';
    const newTeacher: ClassroomTeacher = {
      teacher_id: tchr.id,
      name: fullName,
      email: tchr.email || `${tchr.id}@pudding.ac.th`,
      avatar_url: tchr.avatar_url,
      role: newCoTeacherRole,
      institution: tchr.institution,
    };
    if (coTeachersDraft.some((t) => t.teacher_id === newTeacher.teacher_id)) {
      alert(language === 'th' ? 'ครูท่านนี้อยู่ในรายวิชาแล้ว' : 'Teacher is already added');
      return;
    }
    setCoTeachersDraft([...coTeachersDraft, newTeacher]);
    setTeacherSearchQuery('');
    setTeacherSearchResults([]);
  };

  const handleAddCoTeacher = () => {
    if (!newCoTeacherFirst.trim() || !newCoTeacherLast.trim()) {
      alert(language === 'th' ? 'กรุณากรอกทั้งชื่อและนามสกุลของครู' : 'Please provide both first and last name');
      return;
    }
    const fullName = `${newCoTeacherFirst.trim()} ${newCoTeacherLast.trim()}`;
    const newTeacher: ClassroomTeacher = {
      teacher_id: `teacher-${Date.now()}`,
      name: fullName,
      email: newCoTeacherEmail.trim() || `${newCoTeacherFirst.trim().toLowerCase()}@pudding.ac.th`,
      avatar_url: `https://images.unsplash.com/photo-${1534528741775 + Math.floor(Math.random() * 100)}?w=150`,
      role: newCoTeacherRole,
      institution: teacherProfile?.institution,
    };
    setCoTeachersDraft([...coTeachersDraft, newTeacher]);
    setNewCoTeacherFirst('');
    setNewCoTeacherLast('');
    setNewCoTeacherEmail('');
  };

  const handleRemoveCoTeacher = (teacherId: string) => {
    const target = coTeachersDraft.find((t) => t.teacher_id === teacherId);
    if (target?.role === 'primary') {
      alert(language === 'th' ? 'ไม่สามารถลบครูผู้สอนหลักได้' : 'Cannot remove primary owner teacher');
      return;
    }
    setCoTeachersDraft(coTeachersDraft.filter((t) => t.teacher_id !== teacherId));
  };

  const handleSaveCoTeachers = async () => {
    if (!editingCourseCoTeachers) return;
    await dataService.updateCourse(editingCourseCoTeachers.id, {
      teachers: coTeachersDraft,
    });
    showToast(language === 'th' ? 'บันทึกครูร่วมสอนเรียบร้อย' : 'Co-teaching configuration updated');
    setIsCoTeachersModalOpen(false);
    await loadAllData();
  };

  const handleCopyTeacherInviteLink = (course: Course, role: 'assistant' | 'researcher' = 'assistant') => {
    const teacherName = `${clerkUser?.firstName || ''} ${clerkUser?.lastName || ''}`.trim() || 'อาจารย์';
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const inviteUrl = `${origin}/teacher-invite?courseId=${course.id}&inviter=${encodeURIComponent(teacherName)}&role=${role}`;
    navigator.clipboard.writeText(inviteUrl);
    setIsCopiedTeacherLink(true);
    setTimeout(() => setIsCopiedTeacherLink(false), 2500);
  };

  const yearOptions = getAcademicYearOptions(defaultPeriod.yearCE);

  return (
    <div className="space-y-8 pb-20">
      {/* Toast Notice */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 p-4 rounded-2xl bg-amber-500 text-slate-950 font-bold shadow-2xl flex items-center gap-2 text-xs animate-in fade-in slide-in-from-bottom-5">
          <Check className="w-4 h-4" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Hero Welcome Banner with High-Visibility Primary CTAs */}
      <div className="bg-gradient-to-r from-amber-500 via-orange-500 to-yellow-500 rounded-3xl p-6 md:p-8 text-slate-950 shadow-xl shadow-amber-500/10 flex flex-col md:flex-row md:items-center justify-between gap-6 transition-colors">
        <div className="space-y-2 min-w-0 md:min-w-150">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-black/10 backdrop-blur-xs text-xs font-bold text-slate-900">
            <span className="text-sm">🍮</span>
            <span>Pudding Learning Intelligence</span>
          </div>
          <h1 className="text-2xl md:text-3xl font-black tracking-tight text-slate-950">
            {t('dashboard.welcome')}, <br className="md:hidden" />{clerkUser?.fullName || clerkUser?.firstName || t('nav.demo_teacher')}
          </h1>
          <p className="text-slate-900/90 text-sm max-w-xl font-medium">
            {t('dashboard.overview_subtitle')}
          </p>
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => setIsInstitutionModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-black/10 hover:bg-black/20 text-slate-950 font-bold text-xs backdrop-blur-xs transition-colors cursor-pointer border border-black/10"
              title="คลิกเพื่อเลือกหรือแก้ไขสถานศึกษา"
            >
              <Building2 className="w-3.5 h-3.5" />
              <span>{teacherProfile?.institution || (language === 'th' ? '+ ระบุสถานศึกษา/โรงเรียนของคุณครู' : '+ Specify School')}</span>
              <Edit2 className="w-3 h-3 opacity-70 ml-0.5" />
            </button>
          </div>
        </div>

        {/* PRIMARY CTA PROMPTS: Add Course, Add Classroom & Create Assignment/Exam */}
        <div className="flex flex-wrap items-center gap-3">
          {/* 1. Add Course CTA */}
          <button
            type="button"
            onClick={handleOpenCreateCourseModal}
            className="px-3 py-3.5 rounded-2xl bg-white/90 hover:bg-white text-slate-950 font-bold text-sm shadow-lg hover:shadow-xl transition-all hover:scale-105 active:scale-95 flex items-center gap-2 cursor-pointer border border-white/50"
          >
            <div className="w-10 h-10 rounded-xl bg-amber-500 text-slate-950 flex items-center justify-center font-black shadow-md shadow-amber-500/30 group-hover:rotate-6 transition-transform">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <span>
                {t('courses.create_course_modal_title') || '+ เพิ่มรายวิชาใหม่'}
              </span>

            </div>
          </button>

          {/* 2. Add Classroom / Section CTA */}
          <button
            type="button"
            onClick={() => handleOpenCreateClassModal()}
            className="px-3 py-3.5 rounded-2xl bg-white/90 hover:bg-white text-slate-950 font-bold text-sm shadow-lg hover:shadow-xl transition-all hover:scale-105 active:scale-95 flex items-center gap-2 cursor-pointer border border-white/50"
          >
            <div className="w-10 h-10 rounded-xl bg-orange-500 text-white flex items-center justify-center font-black shadow-md shadow-orange-500/30 group-hover:rotate-6 transition-transform">
              <School className="w-5 h-5" />
            </div>
            <div>
              <span>
                {t('dashboard.quick_actions.add_classroom')}
              </span>
            </div>
          </button>

          {/* 3. Create Assignment / Exam CTA */}
          <Link
            href="/creation"
            className="px-3 py-3.5 rounded-2xl bg-slate-950 hover:bg-slate-900 text-white font-bold text-sm shadow-xl shadow-black/25 hover:shadow-2xl transition-all hover:scale-105 active:scale-95 flex items-center gap-2.5 cursor-pointer"
          >
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-500 to-yellow-400 text-slate-950 flex items-center justify-center font-black shadow-md shadow-amber-500/40 group-hover:scale-110 transition-transform">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <span>
                {t('dashboard.quick_actions.create_assignment')}
              </span>
            </div>
          </Link>
        </div>
      </div>

      {/* Dashboard Academic Period Control Bar */}
      <div className="bg-white dark:bg-slate-900 p-4 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-amber-500/10 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold shrink-0">
            <Calendar className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-black text-slate-900 dark:text-white">
                {language === 'th' ? 'ภาพรวมสถิติประจำภาคเรียน' : 'Semester Analytics Overview'}
              </span>
              <span className="px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 text-[11px] font-bold">
                {selectedSemesterKey === 'all'
                  ? (language === 'th' ? 'ทุกภาคเรียนและปีการศึกษา' : 'All Semesters')
                  : formatAcademicPeriod(Number(selectedSemesterKey.split('_')[0]), Number(selectedSemesterKey.split('_')[1]), language)}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {language === 'th'
                ? 'สถิติด้านล่าง (ห้องเรียน นักเรียน งานรอตรวจ และแจ้งเตือนทุจริต) จะอัปเดตและคำนวณตามภาคเรียนที่เลือก'
                : 'All metric cards below calculate and filter dynamically according to the selected academic term.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
          <span className="text-xs font-bold text-slate-600 dark:text-slate-300 hidden md:inline">
            <Calendar className="w-3.5 h-3.5 inline mr-1 text-amber-500" />
            {t('classroom_mgmt.fields.filter_semester_label')}:
          </span>
          <select
            value={selectedSemesterKey}
            onChange={(e) => setSelectedSemesterKey(e.target.value)}
            className="px-3.5 py-2 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-2 focus:ring-amber-500 cursor-pointer shadow-xs"
          >
            {availableSemesterOptions.map((opt) => (
              <option key={`${opt.semester}_${opt.yearCE}`} value={`${opt.semester}_${opt.yearCE}`}>
                {formatAcademicPeriod(opt.semester, opt.yearCE, language)}{' '}
                {opt.semester === defaultPeriod.semester && opt.yearCE === defaultPeriod.yearCE
                  ? `(${t('classroom_mgmt.fields.active_semester')})`
                  : ''}
              </option>
            ))}
            <option value="all">{t('classroom_mgmt.fields.all_semesters')}</option>
          </select>
        </div>
      </div>

      {/* Top Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Classrooms count */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs hover:border-amber-400 dark:hover:border-amber-500 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              {t('dashboard.stats.active_classrooms')}
            </span>
            <div className="w-9 h-9 rounded-xl bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center">
              <School className="w-5 h-5" />
            </div>
          </div>
          <p className="text-3xl font-black text-slate-900 dark:text-white mt-3">
            {filteredClassrooms.length}
          </p>
          <span className="text-[11px] text-amber-600 dark:text-amber-400 font-semibold mt-1 block">
            {selectedSemesterKey === 'all'
              ? (language === 'th' ? 'ทุกภาคเรียนและปีการศึกษา' : 'All Semesters')
              : formatAcademicPeriod(Number(selectedSemesterKey.split('_')[0]), Number(selectedSemesterKey.split('_')[1]), language)}
          </span>
        </div>

        {/* Total Students */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs hover:border-emerald-400 dark:hover:border-emerald-500 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              {t('dashboard.stats.total_students')}
            </span>
            <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <Users className="w-5 h-5" />
            </div>
          </div>
          <p className="text-3xl font-black text-slate-900 dark:text-white mt-3">
            {totalStudents}
          </p>
          <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium mt-1 block">
            {language === 'th' ? 'เชิญผ่าน LINE LIFF ได้ทันที' : 'Invitable via LINE LIFF'}
          </span>
        </div>

        {/* Pending to Grade */}
        <Link
          href="/assignments/assign-001/grading"
          className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs hover:border-blue-400 dark:hover:border-blue-500 transition-all block group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              {t('dashboard.stats.pending_grading')}
            </span>
            <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center group-hover:scale-110 transition-transform">
              <FileCheck className="w-5 h-5" />
            </div>
          </div>
          <p className="text-3xl font-black text-slate-900 dark:text-white mt-3">
            {pendingGradingCount}
          </p>
          <span className="text-[11px] text-blue-600 dark:text-blue-400 font-medium mt-1 block">
            {language === 'th' ? 'มีคำตอบรอการตรวจแบบ Continuous View' : 'Answers awaiting continuous review'}
          </span>
        </Link>

        {/* Anti-Cheating Alerts */}
        <Link
          href="/assignments/assign-001/grading"
          className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-rose-200 dark:border-rose-900/50 shadow-xs hover:border-rose-400 transition-all block group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-rose-600 dark:text-rose-400">
              {t('dashboard.stats.flagged_suspicious')}
            </span>
            <div className="w-9 h-9 rounded-xl bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center group-hover:scale-110 transition-transform">
              <ShieldAlert className="w-5 h-5 animate-pulse" />
            </div>
          </div>
          <p className="text-3xl font-black text-rose-600 dark:text-rose-400 mt-3">
            {suspiciousAlertCount}
          </p>
          <span className="text-[11px] text-rose-600 dark:text-rose-400 font-semibold mt-1 flex items-center gap-1">
            <span>{language === 'th' ? 'ตรวจดูรายงานความเสี่ยง' : 'View Risk Audit'}</span>
            <ArrowRight className="w-3 h-3" />
          </span>
        </Link>
      </div>

      {/* COURSE-BASED GROUPING VIEW (Course -> Classroom/Section -> Assignment) */}
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-slate-900 p-4 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <FolderKanban className="w-4 h-4 text-amber-500" />
              <span>{t('courses.title')}</span>
              <span className="px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 font-mono text-xs font-bold">
                {courses.length} {t('common.course')}
              </span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {t('courses.subtitle')}
            </p>
          </div>

          {/* Semester Selector */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 dark:text-slate-400 font-semibold hidden sm:inline">
              <Calendar className="w-3.5 h-3.5 inline mr-1 text-amber-500" />
              {t('classroom_mgmt.fields.filter_semester_label')}:
            </span>
            <select
              value={selectedSemesterKey}
              onChange={(e) => setSelectedSemesterKey(e.target.value)}
              className="px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-amber-500 cursor-pointer shadow-xs"
            >
              {availableSemesterOptions.map((opt) => (
                <option key={`${opt.semester}_${opt.yearCE}`} value={`${opt.semester}_${opt.yearCE}`}>
                  {formatAcademicPeriod(opt.semester, opt.yearCE, language)}{' '}
                  {opt.semester === defaultPeriod.semester && opt.yearCE === defaultPeriod.yearCE
                    ? `(${t('classroom_mgmt.fields.active_semester')})`
                    : ''}
                </option>
              ))}
              <option value="all">{t('classroom_mgmt.fields.all_semesters')}</option>
            </select>
          </div>
        </div>

        {/* Grouped Course Cards */}
        <div className="space-y-6">
          {groupedCourses.length === 0 ? (
            <div className="text-center py-16 px-6 bg-white dark:bg-slate-900 rounded-3xl border border-dashed border-slate-300 dark:border-slate-800 space-y-4">
              <div className="w-16 h-16 rounded-3xl bg-amber-50 dark:bg-amber-950/60 text-amber-500 mx-auto flex items-center justify-center text-3xl shadow-xs">
                📚
              </div>
              <div className="space-y-1 max-w-sm mx-auto">
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  {language === "th" ? "ยังไม่มีรายวิชาในระบบสำหรับภาคเรียนนี้" : "No courses for this semester"}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  {language === "th"
                    ? "สร้างรายวิชาใหม่ หรือคัดลอกวิชาจากภาคเรียนอื่นเข้ามาเพื่อเริ่มต้น"
                    : "Create a new course or import from another semester to get started."}
                </p>
              </div>
              <button
                type="button"
                onClick={handleOpenCreateCourseModal}
                className="px-5 py-2.5 rounded-2xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs inline-flex items-center gap-2 shadow-sm transition-transform active:scale-95 cursor-pointer"
              >
                <PlusCircle className="w-4 h-4" />
                <span>+ {language === "th" ? "สร้างรายวิชาใหม่" : "Create Course"}</span>
              </button>
            </div>
          ) : (
            groupedCourses.map((course) => (
            <div
              key={course.id}
              className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xs p-6 space-y-6 transition-all hover:border-slate-300 dark:hover:border-slate-700"
            >
              {/* Course Header */}
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-0.5 rounded-lg bg-amber-100 dark:bg-amber-950/80 text-amber-900 dark:text-amber-300 font-mono text-xs font-bold border border-amber-200 dark:border-amber-900">
                      {course.code}
                    </span>
                    <h3 className="text-lg font-black text-slate-900 dark:text-white">
                      {course.name}
                    </h3>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {course.description || '-'}
                  </p>
                </div>

                {/* Course Control Actions: Rubrics, Co-Teachers, Clone to other term, Add Section & Delete Course */}
                <div className="flex flex-wrap items-center gap-2">
                  {/* Co-Teachers Avatars & Manager Button */}
                  <button
                    type="button"
                    onClick={() => handleOpenCoTeachersModal(course)}
                    className="px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2 cursor-pointer transition-colors"
                    title={t('courses.co_teachers')}
                  >
                    <div className="flex -space-x-1.5 overflow-hidden">
                      {course.teachers?.map((tchr, i) => (
                        <img
                          key={i}
                          src={tchr.avatar_url || 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=100'}
                          alt={tchr.name}
                          className="w-5 h-5 rounded-full object-cover ring-1 ring-white dark:ring-slate-900"
                        />
                      ))}
                    </div>
                    <span>{course.teachers?.length || 1} {language === 'th' ? 'ครูผู้สอน' : 'Teachers'}</span>
                  </button>

                  {/* Learning Indicators Settings - Only Course Owner */}
                  {(!course.primary_teacher_id || course.primary_teacher_id === clerkUser?.id || course.primary_teacher_id === 'teacher-default') ? (
                    <>
                      <button
                        type="button"
                        onClick={() => handleOpenIndicatorsModal(course)}
                        className="px-3.5 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5 cursor-pointer transition-colors"
                      >
                        <Sliders className="w-3.5 h-3.5 text-amber-500" />
                        <span>{t('dashboard.classrooms_section.course_settings_btn')}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleCloneCourseToOtherSemester(course)}
                        className="px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5 cursor-pointer transition-colors"
                        title={language === 'th' ? 'คัดลอกวิชานี้ไปยังเทอมอื่น' : 'Add this course to another semester'}
                      >
                        <Copy className="w-3.5 h-3.5 text-amber-500" />
                        <span>{language === 'th' ? 'เพิ่มไปเทอมอื่น' : 'Add to Term'}</span>
                      </button>
                    </>
                  ) : (
                    <span className="px-2.5 py-1 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-bold text-[11px] border border-blue-200/60 dark:border-blue-800/60 flex items-center gap-1">
                      <GraduationCap className="w-3.5 h-3.5" />
                      <span>{language === 'th' ? 'ผู้ช่วยสอน (ตรวจงานได้)' : 'TA Access'}</span>
                    </span>
                  )}

                  {/* Add Classroom Section Under This Course (Pre-fills this course & semester) */}
                  <button
                    type="button"
                    onClick={() => handleOpenCreateClassModal(course)}
                    className="px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs flex items-center gap-1.5 cursor-pointer transition-colors shadow-xs"
                  >
                    <PlusCircle className="w-3.5 h-3.5" />
                    <span>+ {language === 'th' ? 'เพิ่มห้องเรียน' : 'Add Classroom'}</span>
                  </button>

                  {/* Delete Course Button - Only Course Owner */}
                  {(!course.primary_teacher_id || course.primary_teacher_id === clerkUser?.id || course.primary_teacher_id === 'teacher-default') && (
                    <button
                      type="button"
                      onClick={() => handleDeleteCourse(course)}
                      className="p-1.5 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 border border-transparent hover:border-rose-200 dark:hover:border-rose-900 transition-colors cursor-pointer"
                      title={language === 'th' ? `ลบรายวิชา ${course.code}` : `Delete Course ${course.code}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Sub-sections Grid (Classrooms belonging to this Course) */}
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs font-bold text-slate-500 dark:text-slate-400">
                  <span>{language === 'th' ? 'ห้องเรียนในสังกัด' : 'Classrooms'} ({course.sections.length})</span>
                  <span className="text-[11px] font-normal">
                    {course.assignments.length} {language === 'th' ? 'ชิ้นงาน/ข้อสอบ' : 'Tasks'}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {course.sections.length === 0 ? (
                    <div className="col-span-full p-6 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl text-xs text-slate-400">
                      {language === 'th' ? 'ยังไม่มีห้องเรียนในรายวิชานี้ กดปุ่ม "เพิ่มห้องเรียน" เพื่อสร้างห้องเรียน' : 'No classroom enrolled under this course yet.'}
                    </div>
                  ) : (
                    course.sections.map((cls) => {
                      const count = cls.students ? cls.students.length : (cls.student_count || 0);

                      return (
                        <div
                          key={cls.id}
                          className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/60 flex flex-col justify-between space-y-4 hover:border-amber-400 dark:hover:border-amber-500 transition-all"
                        >
                          <div>
                            <div className="flex items-center justify-between text-xs mb-1.5">
                              <span className="font-mono text-[11px] font-bold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/60 px-2 py-0.5 rounded">
                                {cls.invite_code || 'OMU'}
                              </span>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => handleOpenEditClassModal(cls)}
                                  className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded"
                                  title={t('common.edit')}
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteClassroom(cls)}
                                  className="p-1 text-slate-400 hover:text-rose-500 rounded"
                                  title={t('common.delete')}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>

                            <h4 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-1.5 flex-wrap">
                              <span>{cls.name}</span>
                              {selectedSemesterKey === 'all' && (
                                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-amber-100/90 dark:bg-amber-950/80 text-amber-900 dark:text-amber-300">
                                  {cls.semester === 3 ? 'ซัมเมอร์' : `เทอม ${cls.semester || 1}`}
                                </span>
                              )}
                            </h4>
                            <div className="flex items-center justify-between mt-1 gap-2 flex-wrap">
                              <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                                <Users className="w-3.5 h-3.5" />
                                <span>{count} {t('common.student')}</span>
                              </p>
                              {cls.pending_students && cls.pending_students.length > 0 && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setManagingClassroom(cls);
                                    setStudentTab('pending');
                                  }}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-500 text-white text-[10px] font-black animate-pulse cursor-pointer shadow-xs hover:bg-rose-600 transition-colors"
                                  title="คลิกเพื่ออนุมัตินักเรียนเข้าห้องเรียน"
                                >
                                  <UserPlus className="w-3 h-3" />
                                  <span>รออนุมัติ {cls.pending_students.length} คน (Admit)</span>
                                </button>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-200/60 dark:border-slate-700/60">
                            <button
                              type="button"
                              onClick={() => {
                                setManagingClassroom(cls);
                                setStudentTab('roster');
                              }}
                              className="text-xs font-bold text-amber-600 dark:text-amber-400 hover:underline flex items-center gap-1 cursor-pointer"
                            >
                              <span>{t('dashboard.classrooms_section.view_class')}</span>
                              <ArrowRight className="w-3 h-3" />
                            </button>

                            <button
                              type="button"
                              onClick={() => handleCopyLiff(cls)}
                              className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold flex items-center gap-1 shadow-xs cursor-pointer"
                              title="LINE LIFF"
                            >
                              <MessageCircle className="w-3 h-3" />
                              <span>LINE</span>
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Course-level Assignments preview */}
              {course.assignments.length > 0 && (
                <div className="pt-2">
                  <div className="text-xs font-bold text-slate-500 dark:text-slate-400 mb-2 flex items-center gap-1.5">
                    <FileCheck className="w-3.5 h-3.5 text-blue-500" />
                    <span>{language === 'th' ? 'การบ้านและข้อสอบประจำวิชา' : 'Course Assignments & Assessments'}</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {course.assignments.map((asg) => (
                      <div
                        key={asg.id}
                        className="p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 shadow-xs"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                                asg.is_exam
                                  ? 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300'
                                  : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                              }`}
                            >
                              {asg.is_exam ? t('assignment_creator.mode_exam') : t('assignment_creator.mode_assignment')}
                            </span>
                            <span className="text-[11px] text-slate-400 truncate">
                              {asg.classroom_name}
                            </span>
                          </div>
                          <h5 className="font-bold text-xs text-slate-900 dark:text-white truncate">
                            {asg.title}
                          </h5>
                        </div>

                        <Link
                          href={`/assignments/${asg.id}/grading`}
                          className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-bold transition-all shadow-xs flex items-center gap-1 shrink-0 cursor-pointer"
                        >
                          <span>{t('dashboard.pending_section.grade_now')}</span>
                          <ArrowRight className="w-3 h-3" />
                        </Link>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            ))
          )}
        </div>
      </div>

      {/* COURSE INDICATORS & RUBRICS CONFIGURATION MODAL */}
      {isIndicatorsModalOpen && editingCourseIndicators && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in"
          onClick={() => setIsIndicatorsModalOpen(false)}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-3xl max-w-2xl w-full border border-slate-200 dark:border-slate-800 shadow-2xl p-6 space-y-6 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-amber-500/20 text-amber-600 dark:text-amber-400">
                  <Sliders className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">
                    {t('indicators_config.title')}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {editingCourseIndicators.code} - {editingCourseIndicators.name}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsIndicatorsModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Course Read-only Banner */}
            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-mono font-bold text-xs px-2.5 py-1 rounded-lg bg-amber-100 dark:bg-amber-950 text-amber-900 dark:text-amber-300 border border-amber-300 dark:border-amber-900">
                  {editingCourseIndicators.code}
                </span>
                <span className="font-bold text-xs text-slate-800 dark:text-slate-200">
                  {editingCourseIndicators.name}
                </span>
              </div>
              <span className="text-[11px] font-semibold text-slate-400">
                {formatAcademicPeriod(editingCourseIndicators.semester, editingCourseIndicators.year_ce, language)}
              </span>
            </div>

            {/* Saved Indicators Library Suggestions (Reuse in other courses) */}
            {savedTeacherIndicators.length > 0 && (
              <div className="p-3.5 rounded-2xl bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/60 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-amber-900 dark:text-amber-300 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                    <span>{t('indicators_config.saved_library_title')} ({savedTeacherIndicators.length})</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsSavedLibraryOpen(!isSavedLibraryOpen)}
                    className="text-[11px] font-bold text-amber-700 dark:text-amber-400 hover:underline cursor-pointer"
                  >
                    {isSavedLibraryOpen ? 'ซ่อนคลังตัวชี้วัด' : 'แสดงคลังตัวชี้วัด (คลิกเพื่อเลือกใช้)'}
                  </button>
                </div>
                {isSavedLibraryOpen && (
                  <div className="space-y-2 pt-1 max-h-48 overflow-y-auto pr-1">
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {t('indicators_config.saved_library_desc')}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {savedTeacherIndicators.map((sInd) => (
                        <button
                          key={sInd.id}
                          type="button"
                          onClick={() => handleAddFromSavedLibrary(sInd)}
                          className="px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-800 hover:border-amber-500 text-left text-xs text-slate-800 dark:text-slate-200 transition-all hover:scale-[1.01] flex items-center gap-1.5 cursor-pointer shadow-2xs"
                        >
                          {sInd.code && (
                            <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300">
                              {sInd.code}
                            </span>
                          )}
                          <span className="line-clamp-1 max-w-[280px]">{sInd.title}</span>
                          <PlusCircle className="w-3.5 h-3.5 text-amber-600 shrink-0 ml-1" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Indicator Items List (Numbered items, easy to add/remove) */}
            <div className="space-y-3">
              {indicatorListDraft.length === 0 ? (
                <div className="p-8 text-center border border-dashed border-slate-300 dark:border-slate-800 rounded-2xl text-xs text-slate-400">
                  ยังไม่มีตัวชี้วัดในรายวิชานี้ กดปุ่มด้านล่างเพื่อเพิ่มข้อใหม่
                </div>
              ) : (
                indicatorListDraft.map((ind, idx) => (
                  <div
                    key={ind.id}
                    className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 space-y-2.5"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="px-2.5 py-0.5 rounded-lg bg-amber-500 text-slate-950 font-black text-xs font-mono">
                          {t('indicators_config.item_label')} {idx + 1}
                        </span>
                        <input
                          type="text"
                          value={ind.code}
                          onChange={(e) => {
                            const copy = [...indicatorListDraft];
                            copy[idx].code = e.target.value;
                            setIndicatorListDraft(copy);
                          }}
                          placeholder="รหัส เช่น ท 1.1 ม.4/1 (ถ้ามี)"
                          className="w-40 px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-900 dark:text-white font-mono"
                        />
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => handleMoveIndicator(idx, 'up')}
                          className="p-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 disabled:opacity-30 hover:bg-slate-100 cursor-pointer"
                          title={t('indicators_config.move_up')}
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === indicatorListDraft.length - 1}
                          onClick={() => handleMoveIndicator(idx, 'down')}
                          className="p-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 disabled:opacity-30 hover:bg-slate-100 cursor-pointer"
                          title={t('indicators_config.move_down')}
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteIndicatorDraft(idx)}
                          className="p-1 rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                          title="ลบตัวชี้วัดนี้"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <textarea
                      rows={2}
                      value={ind.title}
                      onChange={(e) => {
                        const copy = [...indicatorListDraft];
                        copy[idx].title = e.target.value;
                        setIndicatorListDraft(copy);
                      }}
                      placeholder={t('indicators_config.title_label')}
                      className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white resize-none focus:outline-hidden focus:border-amber-500"
                    />
                  </div>
                ))
              )}
            </div>

            <button
              type="button"
              onClick={handleAddIndicatorDraft}
              className="w-full py-2.5 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <PlusCircle className="w-4 h-4 text-amber-500" />
              <span>+ {t('indicators_config.add_indicator')} (ข้อที่ {indicatorListDraft.length + 1})</span>
            </button>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setIsIndicatorsModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={handleSaveIndicators}
                className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-bold shadow-xs cursor-pointer"
              >
                {t('indicators_config.save_indicators')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CO-TEACHING SETUP MODAL */}
      {isCoTeachersModalOpen && editingCourseCoTeachers && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in"
          onClick={() => setIsCoTeachersModalOpen(false)}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-3xl max-w-2xl w-full border border-slate-200 dark:border-slate-800 shadow-2xl p-6 space-y-6 max-h-[92vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-amber-500" />
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  {t('courses.co_teachers')} — {editingCourseCoTeachers.code} {editingCourseCoTeachers.name}
                </h3>
              </div>
              <button
                onClick={() => setIsCoTeachersModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Role Definitions & Rules Banner */}
            <div className="p-4 rounded-2xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 space-y-2 text-xs">
              <div className="flex items-center gap-2 font-bold text-amber-900 dark:text-amber-200">
                <ShieldCheck className="w-4 h-4 text-amber-600 shrink-0" />
                <span>โครงสร้างบทบาทครูร่วมในรายวิชา (Co-Teaching Architecture)</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 pt-1 text-[11px] leading-relaxed">
                <div className="p-2.5 rounded-xl bg-blue-50/80 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/50 text-blue-950 dark:text-blue-200">
                  <span className="font-bold block mb-1">👨‍🏫 ครูผู้ช่วยสอน (Teaching Assistant - TA):</span>
                  <span>ตรวจงานและให้คะแนนแก่นักเรียนได้จริง แต่<strong>ไม่สามารถแก้ไขรายวิชาหรือรายละเอียดวิชาได้</strong> (สงวนเฉพาะครูเจ้าของวิชา) และจะค้นหาจากสถาบันเดียวกัน</span>
                </div>
                <div className="p-2.5 rounded-xl bg-purple-50/80 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-900/50 text-purple-950 dark:text-purple-200">
                  <span className="font-bold block mb-1">🔬 ครูตรวจเพื่อวิจัย (Research Evaluator):</span>
                  <span>ตรวจเพื่อวิจัย/วัดความเที่ยงตรง (IRR) เท่านั้น <strong>จะไม่แสดงในหน้า LIFF ของนักเรียน</strong> และคะแนนจะถูกแยกเก็บเฉพาะ ไม่ปนกับคะแนนทางการของวิชา</span>
                </div>
              </div>
            </div>

            {/* Existing Teachers in this Course */}
            <div className="space-y-2">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 block">
                รายชื่อครูในรายวิชานี้ ({coTeachersDraft.length} ท่าน)
              </span>
              <div className="space-y-2">
                {coTeachersDraft.map((tchr) => (
                  <div
                    key={tchr.teacher_id}
                    className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <img
                        src={tchr.avatar_url || 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=100'}
                        alt=""
                        className="w-9 h-9 rounded-full object-cover shrink-0"
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-xs text-slate-900 dark:text-white truncate">
                            {tchr.name}
                          </span>
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                              tchr.role === 'primary'
                                ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 dark:border-amber-800'
                                : tchr.role === 'researcher'
                                ? 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300 border border-purple-300 dark:border-purple-800'
                                : 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 border border-blue-300 dark:border-blue-800'
                            }`}
                          >
                            {tchr.role === 'primary'
                              ? '👑 เจ้าของวิชา (Primary Owner)'
                              : tchr.role === 'researcher'
                              ? '🔬 ตรวจเพื่อวิจัย (Research Evaluator)'
                              : '👨‍🏫 ผู้ช่วยสอน (Teaching Assistant)'}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5 flex-wrap">
                          {tchr.institution && (
                            <span className="text-slate-600 dark:text-slate-300">
                              🏫 {tchr.institution}
                            </span>
                          )}
                          <span className="font-mono">{tchr.email}</span>
                        </div>
                      </div>
                    </div>

                    {tchr.role !== 'primary' && (
                      <button
                        type="button"
                        onClick={() => handleRemoveCoTeacher(tchr.teacher_id)}
                        className="p-1.5 text-slate-400 hover:text-rose-500 rounded-lg cursor-pointer transition-colors"
                        title="นำครูท่านนี้ออกจากรายวิชา"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Add New Teacher Form & Autocomplete Search */}
            <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30 space-y-4">
              <div>
                <span className="text-xs font-bold text-slate-900 dark:text-slate-100 block">
                  + เพิ่มครูร่วมสอนในรายวิชา
                </span>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  เลือกบทบาทที่ต้องการเพิ่ม จากนั้นค้นหาด้วยชื่อหรืออีเมล หรือกรอกข้อมูลด้วยตนเอง
                </p>
              </div>

              {/* Role Toggle Switcher */}
              <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 dark:bg-slate-800 rounded-2xl">
                <button
                  type="button"
                  onClick={() => {
                    setNewCoTeacherRole('assistant');
                    if (teacherSearchQuery) handleSearchTeachers(teacherSearchQuery);
                  }}
                  className={`py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                    newCoTeacherRole === 'assistant'
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <GraduationCap className="w-4 h-4" />
                  <span>ครูผู้ช่วยสอน (TA)</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setNewCoTeacherRole('researcher');
                    if (teacherSearchQuery) handleSearchTeachers(teacherSearchQuery);
                  }}
                  className={`py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                    newCoTeacherRole === 'researcher'
                      ? 'bg-purple-600 text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <FlaskConical className="w-4 h-4" />
                  <span>ครูตรวจเพื่อวิจัย (Researcher)</span>
                </button>
              </div>

              {/* Role Context Notification */}
              <div className="text-[11px] px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 flex items-center gap-2">
                {newCoTeacherRole === 'assistant' ? (
                  <>
                    <Search className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                    <span>ระบบจะค้นหาครูที่สังกัดสถาบันเดียวกัน: <b>{teacherProfile?.institution || 'สถาบันเดียวกับคุณ'}</b></span>
                  </>
                ) : (
                  <>
                    <Search className="w-3.5 h-3.5 text-purple-500 shrink-0" />
                    <span>ระบบค้นหาครูจากทุกสถาบัน (ผู้ประเมินภายนอกเพื่อการวิจัย / Inter-Rater Reliability)</span>
                  </>
                )}
              </div>

              {/* Autocomplete Search Input */}
              <div className="relative">
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={teacherSearchQuery}
                    onChange={(e) => handleSearchTeachers(e.target.value)}
                    placeholder={
                      newCoTeacherRole === 'assistant'
                        ? 'ค้นหาครูผู้ช่วยสอนด้วยชื่อ หรืออีเมล (สถาบันเดียวกัน)...'
                        : 'ค้นหาครูตรวจวิจัยด้วยชื่อ หรืออีเมล (จากทุกสถาบัน)...'
                    }
                    className="w-full pl-9 pr-9 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white focus:outline-hidden focus:border-amber-500"
                  />
                  {isSearchingTeachers && (
                    <Loader2 className="w-4 h-4 text-amber-500 animate-spin absolute right-3 top-1/2 -translate-y-1/2" />
                  )}
                </div>

                {/* Autocomplete Results Dropdown */}
                {teacherSearchResults.length > 0 && (
                  <div className="mt-2 p-2 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-lg space-y-1 max-h-48 overflow-y-auto">
                    <span className="text-[10px] font-bold text-slate-400 px-2 block">
                      ผลการค้นหา ({teacherSearchResults.length} ท่าน)
                    </span>
                    {teacherSearchResults.map((tchr) => (
                      <div
                        key={tchr.id}
                        className="p-2 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/80 flex items-center justify-between gap-2 transition-colors"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <img
                            src={tchr.avatar_url || 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=100'}
                            alt=""
                            className="w-7 h-7 rounded-full object-cover shrink-0"
                          />
                          <div className="min-w-0">
                            <span className="font-bold text-xs text-slate-900 dark:text-white block truncate">
                              {`${tchr.first_name || ''} ${tchr.last_name || ''}`.trim() || tchr.name || 'ครูผู้สอน'}
                            </span>
                            <span className="text-[10px] text-slate-400 block truncate">
                              {tchr.institution ? `🏫 ${tchr.institution} • ` : ''}{tchr.email}
                            </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleSelectFoundTeacher(tchr)}
                          className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-600 text-slate-950 text-[11px] font-bold shrink-0 cursor-pointer"
                        >
                          + เพิ่ม
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Manual Entry Fallback Form */}
              <div className="pt-2 border-t border-slate-200/60 dark:border-slate-700/60 space-y-2">
                <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 block">
                  หรือกรอกข้อมูลด้วยตนเอง (หากยังไม่มีในระบบค้นหา):
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <input
                    type="text"
                    value={newCoTeacherFirst}
                    onChange={(e) => setNewCoTeacherFirst(e.target.value)}
                    placeholder="ชื่อ *"
                    className="px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white focus:outline-hidden focus:border-amber-500"
                  />
                  <input
                    type="text"
                    value={newCoTeacherLast}
                    onChange={(e) => setNewCoTeacherLast(e.target.value)}
                    placeholder="นามสกุล *"
                    className="px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white focus:outline-hidden focus:border-amber-500"
                  />
                  <input
                    type="email"
                    value={newCoTeacherEmail}
                    onChange={(e) => setNewCoTeacherEmail(e.target.value)}
                    placeholder="อีเมล (ถ้ามี)"
                    className="px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white focus:outline-hidden focus:border-amber-500"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleAddCoTeacher}
                  className="w-full py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold cursor-pointer transition-colors"
                >
                  + บันทึกเพิ่ม{newCoTeacherRole === 'assistant' ? 'ครูผู้ช่วยสอน (TA)' : 'ครูตรวจวิจัย (Researcher)'}
                </button>
              </div>
            </div>

            {/* Teacher Web & LINE Invite Link Section */}
            {editingCourseCoTeachers && (
              <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-300 dark:border-amber-800/80 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-amber-900 dark:text-amber-300 flex items-center gap-1.5">
                    <FlaskConical className="w-3.5 h-3.5 text-amber-600" />
                    <span>เชิญครูร่วมสอนผ่านลิงก์ / LINE (แยกบทบาทชัดเจน)</span>
                  </span>
                </div>

                {/* Invite Link Role Tabs */}
                <div className="flex items-center gap-2 p-1 bg-white/70 dark:bg-slate-900/70 rounded-xl border border-amber-200 dark:border-amber-900/60">
                  <button
                    type="button"
                    onClick={() => setInviteRoleTab('assistant')}
                    className={`flex-1 py-1.5 px-2.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                      inviteRoleTab === 'assistant'
                        ? 'bg-blue-600 text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                    }`}
                  >
                    👨‍🏫 คำเชิญ: ครูผู้ช่วยสอน (TA)
                  </button>
                  <button
                    type="button"
                    onClick={() => setInviteRoleTab('researcher')}
                    className={`flex-1 py-1.5 px-2.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                      inviteRoleTab === 'researcher'
                        ? 'bg-purple-600 text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                    }`}
                  >
                    🔬 คำเชิญ: ครูตรวจวิจัย (Researcher)
                  </button>
                </div>

                <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                  {inviteRoleTab === 'assistant'
                    ? 'ลิงก์นี้สำหรับเชิญครูผู้ช่วยสอน (TA) เพื่อเข้ามาตรวจให้คะแนนจริงในห้องเรียน'
                    : 'ลิงก์นี้สำหรับเชิญครูตรวจงานวิจัย (Research Evaluator) เพื่อเข้ามาประเมินความเที่ยงตรง (IRR) โดยไม่แสดงคะแนนหรือชื่อต่อนักเรียน'}
                </p>

                <div className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-800 font-mono text-[11px] text-slate-700 dark:text-slate-300 break-all select-all">
                  {typeof window !== 'undefined'
                    ? `${window.location.origin}/teacher-invite?courseId=${editingCourseCoTeachers.id}&inviter=${encodeURIComponent(
                        `${clerkUser?.firstName || ''} ${clerkUser?.lastName || ''}`.trim() || 'อาจารย์'
                      )}&role=${inviteRoleTab}`
                    : `/teacher-invite?courseId=${editingCourseCoTeachers.id}&role=${inviteRoleTab}`}
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => handleCopyTeacherInviteLink(editingCourseCoTeachers, inviteRoleTab)}
                    className="px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-2xs"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>{isCopiedTeacherLink ? 'คัดลอกลิงก์แล้ว!' : `คัดลอกลิงก์เชิญ (${inviteRoleTab === 'assistant' ? 'TA' : 'ผู้วิจัย'})`}</span>
                  </button>

                  <a
                    href={`https://line.me/R/msg/text/?${encodeURIComponent(
                      `ขอเชิญคุณครูเข้าร่วมเป็น${
                        inviteRoleTab === 'assistant'
                          ? 'ครูผู้ช่วยสอน (Teaching Assistant - TA)'
                          : 'ครูผู้ช่วยตรวจงานวิจัย (Research Evaluator)'
                      } วิชา "${editingCourseCoTeachers.code} ${editingCourseCoTeachers.name}" ที่ลิงก์: ${
                        typeof window !== 'undefined' ? window.location.origin : ''
                      }/teacher-invite?courseId=${editingCourseCoTeachers.id}&inviter=${encodeURIComponent(
                        `${clerkUser?.firstName || ''} ${clerkUser?.lastName || ''}`.trim() || 'อาจารย์'
                      )}&role=${inviteRoleTab}`
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-2xs"
                  >
                    <MessageCircle className="w-3.5 h-3.5" />
                    <span>แชร์คำเชิญไปยัง LINE</span>
                  </a>

                  <a
                    href={`mailto:?subject=${encodeURIComponent(
                      `คำเชิญเป็น${
                        inviteRoleTab === 'assistant' ? 'ครูผู้ช่วยสอน' : 'ครูตรวจงานวิจัย'
                      } วิชา ${editingCourseCoTeachers.code}`
                    )}&body=${encodeURIComponent(
                      `เรียนคุณครู,\n\nขอเชิญเข้าร่วมเป็น${
                        inviteRoleTab === 'assistant'
                          ? 'ครูผู้ช่วยสอน (Teaching Assistant - TA)'
                          : 'ครูผู้ช่วยตรวจงานวิจัย (Research Evaluator)'
                      } สำหรับรายวิชา "${editingCourseCoTeachers.code} ${editingCourseCoTeachers.name}"\n\nท่านสามารถกดยืนยันคำเชิญได้ที่ลิงก์นี้:\n${
                        typeof window !== 'undefined' ? window.location.origin : ''
                      }/teacher-invite?courseId=${editingCourseCoTeachers.id}&role=${inviteRoleTab}\n\nขอบคุณครับ/ค่ะ`
                    )}`}
                    className="px-3.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs flex items-center gap-1.5 cursor-pointer"
                  >
                    <Mail className="w-3.5 h-3.5" />
                    <span>ส่งอีเมลเชิญ</span>
                  </a>
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setIsCoTeachersModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={handleSaveCoTeachers}
                className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-bold shadow-xs cursor-pointer"
              >
                {t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CREATE / EDIT CLASSROOM SECTION MODAL */}
      {isClassModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in"
          onClick={() => setIsClassModalOpen(false)}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-3xl max-w-lg w-full border border-slate-200 dark:border-slate-800 shadow-2xl p-6 space-y-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                {editingClassroom
                  ? t('classroom_mgmt.edit_class_modal_title')
                  : t('classroom_mgmt.create_class_modal_title')}
              </h3>
              <button
                onClick={() => setIsClassModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveClassroom} className="space-y-4">
              {/* Parent Course Selector */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  {t('classroom_mgmt.fields.parent_course')} *
                </label>
                <select
                  required
                  value={selectedCourseForClass}
                  onChange={(e) => {
                    const selId = e.target.value;
                    setSelectedCourseForClass(selId);
                    const selCourse = courses.find((c) => c.id === selId);
                    if (selCourse) {
                      setSubjectCodeInput(`${selCourse.code} ${selCourse.name}`);
                      setFormSemester(selCourse.semester || defaultPeriod.semester);
                      setFormYearCE(selCourse.year_ce || defaultPeriod.yearCE);
                    }
                  }}
                  className={`w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border text-xs font-bold text-slate-900 dark:text-white focus:outline-hidden focus:border-amber-500 cursor-pointer ${
                    !selectedCourseForClass
                      ? 'border-amber-500/80 ring-2 ring-amber-500/20'
                      : 'border-slate-200 dark:border-slate-700'
                  }`}
                >
                  <option value="">
                    {t('classroom_mgmt.fields.select_course_placeholder')}
                  </option>
                  {courses.map((crs) => (
                    <option key={crs.id} value={crs.id}>
                      {crs.code} - {crs.name} ({formatAcademicPeriod(crs.semester, crs.year_ce, language)})
                    </option>
                  ))}
                </select>
                {!selectedCourseForClass && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                    ⚠️ {language === 'th' ? 'กรุณาเลือกรายวิชาก่อนบันทึก' : 'Please select a course first'}
                  </p>
                )}
              </div>

              {/* Classroom Section Name */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  {t('classroom_mgmt.fields.name_label')} *
                </label>
                <input
                  type="text"
                  required
                  value={classNameInput}
                  onChange={(e) => setClassNameInput(e.target.value)}
                  placeholder={t('classroom_mgmt.fields.name_placeholder')}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs focus:outline-hidden focus:border-amber-500 font-medium text-slate-900 dark:text-white"
                />
              </div>

              {/* SELECTABLE SEMESTER AND ACADEMIC YEAR */}
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    {t('classroom_mgmt.fields.semester_label')} *
                  </label>
                  <select
                    value={formSemester}
                    onChange={(e) => setFormSemester(Number(e.target.value))}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-900 dark:text-white focus:outline-hidden focus:border-amber-500 cursor-pointer"
                  >
                    <option value={1}>{t('classroom_mgmt.fields.semester_1')}</option>
                    <option value={2}>{t('classroom_mgmt.fields.semester_2')}</option>
                    <option value={3}>{t('classroom_mgmt.fields.semester_3')}</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    {t('classroom_mgmt.fields.year_label')} *
                  </label>
                  <select
                    value={formYearCE}
                    onChange={(e) => setFormYearCE(Number(e.target.value))}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-900 dark:text-white focus:outline-hidden focus:border-amber-500 cursor-pointer"
                  >
                    {yearOptions.map((yr) => (
                      <option key={yr} value={yr}>
                        {language === 'th' ? `พ.ศ. ${yr + 543}` : `C.E. ${yr}`}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-4">
                <button
                  type="button"
                  onClick={() => setIsClassModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-bold shadow-xs cursor-pointer"
                >
                  {t('common.save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CREATE NEW COURSE MODAL */}
      {isCourseModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in"
          onClick={() => setIsCourseModalOpen(false)}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-3xl max-w-lg w-full border border-slate-200 dark:border-slate-800 shadow-2xl p-6 space-y-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-amber-100 dark:bg-amber-950 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                  <BookOpen className="w-4 h-4" />
                </div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  {t('courses.create_course_modal_title') || (language === 'th' ? 'สร้างรายวิชาใหม่' : 'Create New Course')}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsCourseModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveCourse} className="space-y-4">
              {/* Optional: Import/Clone from Existing Course */}
              {courses.length > 0 && (
                <div className="p-3 rounded-2xl bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/60 space-y-1.5">
                  <label className="text-xs font-bold text-amber-900 dark:text-amber-300 flex items-center gap-1.5">
                    <Copy className="w-3.5 h-3.5 text-amber-600" />
                    <span>{language === 'th' ? 'คัดลอกข้อมูลจากวิชาเดิม (ตัวเลือก)' : 'Import from existing course (Optional)'}</span>
                  </label>
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      const selId = e.target.value;
                      if (!selId) return;
                      const sel = courses.find((c) => c.id === selId);
                      if (sel) {
                        setCourseCodeInput(sel.code);
                        setCourseNameInput(sel.name);
                        setCourseDescInput(sel.description || '');
                        setCourseIndicatorsDraft(sel.indicators || []);
                      }
                    }}
                    className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-800 text-xs font-medium text-slate-800 dark:text-slate-200 focus:outline-hidden cursor-pointer"
                  >
                    <option value="">{language === 'th' ? '-- สร้างวิชาใหม่จากศูนย์ --' : '-- Start from scratch --'}</option>
                    {courses.map((crs) => (
                      <option key={crs.id} value={crs.id}>
                        {crs.code} - {crs.name} ({formatAcademicPeriod(crs.semester, crs.year_ce, language)})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Course Code */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  {t('courses.course_code')} *
                </label>
                <input
                  type="text"
                  required
                  value={courseCodeInput}
                  onChange={(e) => setCourseCodeInput(e.target.value)}
                  placeholder={language === 'th' ? 'เช่น ท31103 หรือ ท32102' : 'e.g. TH31103'}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs focus:outline-hidden focus:border-amber-500 font-mono text-slate-900 dark:text-white uppercase font-bold"
                />
              </div>

              {/* Course Name */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  {t('courses.course_name')} *
                </label>
                <input
                  type="text"
                  required
                  value={courseNameInput}
                  onChange={(e) => setCourseNameInput(e.target.value)}
                  placeholder={language === 'th' ? 'เช่น ภาษาไทยเพื่อการนำเสนอและการวิพากษ์' : 'e.g. Thai Presentation & Discourse'}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs focus:outline-hidden focus:border-amber-500 text-slate-900 dark:text-white"
                />
              </div>

              {/* Course Description */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  {t('courses.course_desc')}
                </label>
                <textarea
                  rows={2}
                  value={courseDescInput}
                  onChange={(e) => setCourseDescInput(e.target.value)}
                  placeholder={language === 'th' ? 'คำอธิบายรายวิชาและสาระสำคัญของหลักสูตร...' : 'Curriculum overview and competencies...'}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs focus:outline-hidden focus:border-amber-500 text-slate-900 dark:text-white resize-none"
                />
              </div>

              {/* Semester & Year */}
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    {t('classroom_mgmt.fields.semester_label')} *
                  </label>
                  <select
                    value={courseSemesterInput}
                    onChange={(e) => setCourseSemesterInput(Number(e.target.value))}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-900 dark:text-white focus:outline-hidden focus:border-amber-500 cursor-pointer"
                  >
                    <option value={1}>{t('classroom_mgmt.fields.semester_1')}</option>
                    <option value={2}>{t('classroom_mgmt.fields.semester_2')}</option>
                    <option value={3}>{t('classroom_mgmt.fields.semester_3')}</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    {t('classroom_mgmt.fields.year_label')} *
                  </label>
                  <select
                    value={courseYearInput}
                    onChange={(e) => setCourseYearInput(Number(e.target.value))}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-900 dark:text-white focus:outline-hidden focus:border-amber-500 cursor-pointer"
                  >
                    {yearOptions.map((yr) => (
                      <option key={yr} value={yr}>
                        {language === 'th' ? `พ.ศ. ${yr + 543}` : `C.E. ${yr}`}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-4">
                <button
                  type="button"
                  onClick={() => setIsCourseModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-black shadow-md shadow-amber-500/20 cursor-pointer transition-transform active:scale-95"
                >
                  {t('courses.create_course_btn') || (language === 'th' ? 'สร้างรายวิชา' : 'Create Course')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* STUDENT ROSTER & LINE LIFF INVITE MODAL */}
      {managingClassroom && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in"
          onClick={() => setManagingClassroom(null)}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-3xl max-w-2xl w-full border border-slate-200 dark:border-slate-800 shadow-2xl p-6 space-y-6 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  {managingClassroom.name}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {managingClassroom.subject_code} • {managingClassroom.academic_year}
                </p>
              </div>
              <button
                onClick={() => setManagingClassroom(null)}
                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-2">
              <button
                type="button"
                onClick={() => setStudentTab('roster')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                  studentTab === 'roster'
                    ? 'bg-amber-500 text-slate-950'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                {t('classroom_mgmt.students_tab')} ({managingClassroom.students?.length || 0})
              </button>
              <button
                type="button"
                onClick={() => setStudentTab('pending')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5 ${
                  studentTab === 'pending'
                    ? 'bg-amber-500 text-slate-950'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                <UserCheck className="w-3.5 h-3.5" />
                <span>คำขอรออนุมัติ (Admit)</span>
                {(managingClassroom.pending_students?.length || 0) > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full bg-rose-500 text-white text-[10px] font-black animate-pulse">
                    {managingClassroom.pending_students?.length}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => setStudentTab('line')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5 ${
                  studentTab === 'line'
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                <MessageCircle className="w-3.5 h-3.5" />
                <span>{t('classroom_mgmt.invite_line_title')}</span>
              </button>
            </div>

            {/* Student Roster Tab */}
            {studentTab === 'roster' && (
              <div className="space-y-4">
                {/* Search existing students from institution */}
                <div className="relative">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={studentSearchQuery}
                      onChange={(e) => handleSearchStudents(e.target.value)}
                      placeholder={language === 'th' ? '🔍 ค้นหานักเรียนที่มีในระบบ (ชื่อ, นามสกุล หรือรหัส นร.) เพื่อเพิ่มอย่างรวดเร็ว...' : 'Search student by name or ID...'}
                      className="w-full pl-8 pr-8 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-hidden focus:border-amber-500 font-medium"
                    />
                    {isSearchingStudents && (
                      <Loader2 className="w-3.5 h-3.5 absolute right-3 top-1/2 -translate-y-1/2 text-amber-500 animate-spin" />
                    )}
                  </div>

                  {studentSearchResults.length > 0 && (
                    <div className="absolute z-20 left-0 right-0 mt-1 p-2 bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 space-y-1 max-h-48 overflow-y-auto">
                      {studentSearchResults.map((found) => (
                        <button
                          key={found.id}
                          type="button"
                          onClick={() => {
                            setNewStudentId(found.student_id || '');
                            setNewStudentFirst(found.first_name);
                            setNewStudentLast(found.last_name);
                            setStudentSearchQuery('');
                            setStudentSearchResults([]);
                          }}
                          className="w-full p-2 rounded-xl text-left text-xs hover:bg-amber-50 dark:hover:bg-amber-950/60 flex items-center justify-between gap-2 transition-colors cursor-pointer"
                        >
                          <div className="flex items-center gap-2">
                            <img
                              src={found.avatar_url || 'https://images.unsplash.com/photo-1534528741775?w=100'}
                              alt=""
                              className="w-6 h-6 rounded-full object-cover"
                            />
                            <div>
                              <span className="font-bold text-slate-900 dark:text-white block">
                                {found.first_name} {found.last_name}
                              </span>
                              <span className="text-[10px] text-slate-400">
                                ID: {found.student_id || '-'} • 🏫 {found.institution || '-'}
                              </span>
                            </div>
                          </div>
                          <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400">
                            + เลือก
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Add student inline form */}
                <form
                  onSubmit={handleAddStudent}
                  className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/60 grid grid-cols-1 sm:grid-cols-4 gap-2"
                >
                  <input
                    type="text"
                    value={newStudentId}
                    onChange={(e) => setNewStudentId(e.target.value)}
                    placeholder="รหัสนักเรียน (54101)"
                    className="px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white"
                  />
                  <input
                    type="text"
                    required
                    value={newStudentFirst}
                    onChange={(e) => setNewStudentFirst(e.target.value)}
                    placeholder="ชื่อจริง *"
                    className="px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white"
                  />
                  <input
                    type="text"
                    required
                    value={newStudentLast}
                    onChange={(e) => setNewStudentLast(e.target.value)}
                    placeholder="นามสกุล *"
                    className="px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white"
                  />
                  <button
                    type="submit"
                    className="py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs cursor-pointer"
                  >
                    + เพิ่มนักเรียน
                  </button>
                </form>

                {/* Students list */}
                <div className="space-y-2">
                  {managingClassroom.students?.map((std) => (
                    <div
                      key={std.id}
                      className="p-3 rounded-xl bg-white dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-2.5">
                        <img
                          src={std.avatar_url || 'https://images.unsplash.com/photo-1534528741775?w=100'}
                          alt=""
                          className="w-7 h-7 rounded-full object-cover"
                        />
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-xs text-slate-900 dark:text-white">
                              {std.first_name} {std.last_name}
                            </span>
                            <span className="font-mono text-[10px] text-slate-400">
                              ID: {std.student_id}
                            </span>
                          </div>
                          <span className="text-[11px] text-slate-400 font-mono">
                            {std.email}
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleRemoveStudent(std.id)}
                        className="p-1 text-slate-400 hover:text-rose-500 rounded"
                        title="Remove student"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Pending Admit Requests Tab */}
            {studentTab === 'pending' && (
              <div className="space-y-4">
                <div className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2">
                  <ShieldCheck className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <p className="leading-relaxed">
                    ระบบความปลอดภัยตรวจสอบการเข้าห้องเรียน: นักเรียนที่สแกน QR Code หรือเข้าผ่านรหัสจะอยู่ในสถานะรอการอนุมัติ (Admit) ก่อน เพื่อป้องกันผู้ไม่หวังดีเข้ามาปั่นในห้องเรียน
                  </p>
                </div>

                {(!managingClassroom.pending_students || managingClassroom.pending_students.length === 0) ? (
                  <div className="py-12 text-center text-xs text-slate-400 space-y-2">
                    <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-400 flex items-center justify-center mx-auto text-xl">
                      ✅
                    </div>
                    <p className="font-medium text-slate-600 dark:text-slate-300">
                      ไม่มีคำขอเข้าห้องเรียนที่รอการอนุมัติในขณะนี้
                    </p>
                    <p className="text-[11px] text-slate-400">
                      เมื่อนักเรียนสแกน QR Code หน้าจอนี้จะอัปเดตแบบ Real-time ทันที
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {managingClassroom.pending_students.map((std) => (
                      <div
                        key={std.id}
                        className="p-3.5 rounded-2xl bg-white dark:bg-slate-800 border border-amber-200 dark:border-amber-900/60 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div className="flex items-center gap-3">
                          <img
                            src={std.avatar_url || 'https://images.unsplash.com/photo-1534528741775?w=100'}
                            alt=""
                            className="w-10 h-10 rounded-2xl object-cover ring-2 ring-amber-400 shrink-0"
                          />
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-xs text-slate-900 dark:text-white">
                                {`${std.first_name || ''} ${std.last_name || ''}`.trim() || std.name || 'นักเรียน'}
                              </span>
                              {std.student_id && (
                                <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                                  ID: {std.student_id}
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-2 flex-wrap">
                              <span>🏫 {std.institution || 'ไม่ระบุสถานศึกษา'}</span>
                              {std.line_uid && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                                  <Check className="w-3 h-3" /> LINE Verified
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleAdmitStudent(std.id)}
                            className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-xs transition-all cursor-pointer"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>อนุมัติ (Admit)</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRejectStudent(std.id)}
                            className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-slate-600 hover:text-rose-600 dark:text-slate-300 font-semibold text-xs flex items-center gap-1 transition-colors cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" />
                            <span>ปฏิเสธ</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* LINE LIFF Invite Tab */}
            {studentTab === 'line' && (
              <div className="space-y-5 text-center p-3 sm:p-5">
                <div className="w-12 h-12 rounded-2xl bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto shadow-xs">
                  <MessageCircle className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="font-bold text-base text-slate-900 dark:text-white">
                    {t('classroom_mgmt.invite_line_title')}
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto mt-1">
                    {t('classroom_mgmt.invite_line_desc')}
                  </p>
                </div>

                {/* Invite Code Highlight */}
                {managingClassroom.invite_code && (
                  <div className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 max-w-sm mx-auto flex items-center justify-between">
                    <div className="text-left">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                        {language === 'th' ? 'รหัสเข้าห้องเรียน' : 'Classroom Code'}
                      </div>
                      <div className="text-xl font-black font-mono tracking-widest text-slate-900 dark:text-white">
                        {managingClassroom.invite_code}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(managingClassroom.invite_code || '');
                        setIsCopied(true);
                        setTimeout(() => setIsCopied(false), 2000);
                      }}
                      className="px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 flex items-center gap-1 cursor-pointer"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>{isCopied ? t('classroom_mgmt.copied') : (language === 'th' ? 'คัดลอกรหัส' : 'Copy')}</span>
                    </button>
                  </div>
                )}

                {/* QR Code */}
                <div className="flex flex-col items-center justify-center gap-2">
                  <div className="p-2.5 bg-white rounded-2xl shadow-sm border border-slate-200 inline-block">
                    <img
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(getRealLiffUrl(managingClassroom))}`}
                      alt="LINE LIFF QR Code"
                      className="w-40 h-40 object-contain rounded-lg"
                    />
                  </div>
                  <span className="text-[11px] text-slate-400 font-medium">
                    {language === 'th' ? 'สแกน QR ด้วยแอป LINE เพื่อเข้าห้องเรียนทันที' : 'Scan with LINE to join instantly'}
                  </span>
                </div>

                {/* Real LIFF URL Display */}
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 font-mono text-[11px] text-slate-700 dark:text-slate-300 break-all select-all max-w-lg mx-auto">
                  {getRealLiffUrl(managingClassroom)}
                </div>

                {/* Action Buttons */}
                <div className="flex flex-wrap items-center justify-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => handleCopyLiff(managingClassroom)}
                    className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-xs"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>{isCopied ? t('classroom_mgmt.copied') : t('classroom_mgmt.copy_liff_link')}</span>
                  </button>

                  <a
                    href={`https://line.me/R/msg/text/?${encodeURIComponent(
                      `${language === 'th' ? 'เข้าร่วมห้องเรียน Pudding' : 'Join Pudding Classroom'}: ${managingClassroom.name} (${courses.find((c) => c.id === managingClassroom.course_id)?.name || managingClassroom.subject_code || ''})\n\nกดลิงก์นี้ใน LINE: ${getRealLiffUrl(managingClassroom)}\nรหัสห้องเรียน: ${managingClassroom.invite_code || ''}`
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-xs inline-flex"
                  >
                    <Share2 className="w-3.5 h-3.5" />
                    <span>{language === 'th' ? 'แชร์เข้าแชท LINE' : 'Share to LINE'}</span>
                  </a>

                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(getWebInviteUrl(managingClassroom));
                      setIsCopied(true);
                      setTimeout(() => setIsCopied(false), 2000);
                    }}
                    className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
                  >
                    <Copy className="w-3 h-3" />
                    <span>{language === 'th' ? 'คัดลอกลิงก์เว็บตรง' : 'Copy Web Link'}</span>
                  </button>
                </div>
              </div>
            )}

            {/* Footer Close */}
            <div className="flex justify-end pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setManagingClassroom(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer"
              >
                {t('common.close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TEACHER INSTITUTION MODAL */}
      {isInstitutionModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in"
          onClick={() => setIsInstitutionModalOpen(false)}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-3xl max-w-md w-full border border-slate-200 dark:border-slate-800 shadow-2xl p-6 space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <School className="w-5 h-5 text-amber-500" />
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  {language === 'th' ? 'ระบุสถานศึกษา / โรงเรียนของคุณครู' : 'Set Educational Institution'}
                </h3>
              </div>
              <button
                onClick={() => setIsInstitutionModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                {language === 'th'
                  ? 'เลือกหรือค้นหาโรงเรียน สถาบันการศึกษา หรือมหาวิทยาลัยจากรายชื่อมาตรฐาน เพื่อป้องกันการสะกดชื่อผิด และเชื่อมโยงกับเพื่อนครูและนักเรียนในสถานศึกษาเดียวกันได้อย่างแม่นยำ'
                  : 'Search and select your standard educational institution to ensure consistent grouping with co-teachers and students.'}
              </p>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  {language === 'th' ? 'สถานศึกษา / สถาบัน' : 'Institution'} <span className="text-rose-500">*</span>
                </label>
                <InstitutionSearchSelect
                  value={teacherInstitutionInput}
                  onChange={setTeacherInstitutionInput}
                  placeholder={language === 'th' ? 'พิมพ์ค้นหาชื่อโรงเรียน / วิทยาลัย / มหาวิทยาลัย...' : 'Search school name...'}
                />
              </div>

              {teacherProfile?.institution && (
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 text-xs text-slate-600 dark:text-slate-400">
                  <span>สถานศึกษาปัจจุบัน: </span>
                  <b className="text-slate-900 dark:text-white">{teacherProfile.institution}</b>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setIsInstitutionModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 cursor-pointer"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                disabled={!teacherInstitutionInput.trim()}
                onClick={async () => {
                  const teacherId = clerkUser?.id || 'teacher-default';
                  await dataService.updateUserInstitution(teacherId, teacherInstitutionInput.trim());
                  setTeacherProfile((prev) => (prev ? { ...prev, institution: teacherInstitutionInput.trim() } : null));
                  setIsInstitutionModalOpen(false);
                  showToast(language === 'th' ? 'บันทึกสถานศึกษาเรียบร้อยแล้ว' : 'Institution updated successfully');
                }}
                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-bold shadow-xs cursor-pointer disabled:opacity-50 transition-colors"
              >
                {t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
