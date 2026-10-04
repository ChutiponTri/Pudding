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
} from 'lucide-react';

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
  const [studentTab, setStudentTab] = useState<'roster' | 'line' | 'email'>('roster');
  const [newStudentId, setNewStudentId] = useState('');
  const [newStudentFirst, setNewStudentFirst] = useState('');
  const [newStudentLast, setNewStudentLast] = useState('');
  const [newStudentEmail, setNewStudentEmail] = useState('');
  const [emailInviteList, setEmailInviteList] = useState('');
  const [isCopied, setIsCopied] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Course-level Learning Indicators & Rubrics Settings Modal
  const [editingCourseIndicators, setEditingCourseIndicators] = useState<Course | null>(null);
  const [indicatorListDraft, setIndicatorListDraft] = useState<CourseLearningIndicator[]>([]);
  const [isIndicatorsModalOpen, setIsIndicatorsModalOpen] = useState(false);

  // Co-Teaching Setup Modal
  const [editingCourseCoTeachers, setEditingCourseCoTeachers] = useState<Course | null>(null);
  const [isCoTeachersModalOpen, setIsCoTeachersModalOpen] = useState(false);
  const [coTeachersDraft, setCoTeachersDraft] = useState<ClassroomTeacher[]>([]);
  const [newCoTeacherName, setNewCoTeacherName] = useState('');
  const [newCoTeacherEmail, setNewCoTeacherEmail] = useState('');

  // Course Creation Modal state
  const [isCourseModalOpen, setIsCourseModalOpen] = useState(false);
  const [courseCodeInput, setCourseCodeInput] = useState('');
  const [courseNameInput, setCourseNameInput] = useState('');
  const [courseDescInput, setCourseDescInput] = useState('');
  const [courseSemesterInput, setCourseSemesterInput] = useState<number>(defaultPeriod.semester);
  const [courseYearInput, setCourseYearInput] = useState<number>(defaultPeriod.yearCE);

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

  // Filter classrooms by selected semester
  const filteredClassrooms = useMemo(() => {
    if (selectedSemesterKey === 'all') return classrooms;
    const [semStr, yrStr] = selectedSemesterKey.split('_');
    const sem = Number(semStr);
    const yr = Number(yrStr);
    return classrooms.filter((cls) => {
      const clsSem = cls.semester ?? 1;
      const clsYr = cls.year_ce ?? 2026;
      return clsSem === sem && clsYr === yr;
    });
  }, [classrooms, selectedSemesterKey]);

  // Group classrooms by course
  const groupedCourses = useMemo(() => {
    return courses.map((course) => {
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
  }, [courses, filteredClassrooms, assignments]);

  const totalStudents = classrooms.reduce(
    (acc, c) => acc + (c.students ? c.students.length : (c.student_count || 0)),
    0
  );
  const pendingGradingCount = useMemo(() => {
    return allSubmissions.filter(
      (s) => s.status === "submitted" || s.status === "late" || !s.total_score || s.total_score === 0
    ).length;
  }, [allSubmissions]);

  const suspiciousAlertCount = useMemo(() => {
    return allSubmissions.filter(
      (s) =>
        s.is_flagged_suspicious ||
        (s.tab_switch_count && s.tab_switch_count >= 3) ||
        (s.total_time_away_seconds && s.total_time_away_seconds >= 30)
    ).length;
  }, [allSubmissions]);

  // Course Creation & Deletion Handlers
  const handleOpenCreateCourseModal = () => {
    setCourseCodeInput('');
    setCourseNameInput('');
    setCourseDescInput('');
    setCourseSemesterInput(defaultPeriod.semester);
    setCourseYearInput(defaultPeriod.yearCE);
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
      indicators: [
        {
          id: `ind-${Date.now()}-1`,
          course_id: '',
          code: `${courseCodeInput.trim().toUpperCase()}`,
          title: language === 'th' ? 'การประเมินทักษะการเรียนรู้และการนำไปใช้จริง' : 'Core learning standard & practical application',
          weight: 50,
          order_index: 1,
        },
        {
          id: `ind-${Date.now()}-2`,
          course_id: '',
          code: `${courseCodeInput.trim().toUpperCase()}`,
          title: language === 'th' ? 'การคิดวิเคราะห์อย่างมีวิจารณญาณและการสื่อสาร' : 'Critical analytical thinking & synthesis',
          weight: 50,
          order_index: 2,
        },
      ],
      classroom_ids: [],
    });

    showToast(language === 'th' ? `สร้างรายวิชา ${courseCodeInput.trim()} สำเร็จ` : `Course ${courseCodeInput.trim()} created`);
    setIsCourseModalOpen(false);
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
  const handleOpenCreateClassModal = (courseId?: string) => {
    setEditingClassroom(null);
    setSelectedCourseForClass(courseId || courses[0]?.id || 'course-thai-comm');
    const defaultCourse = courses.find((c) => c.id === (courseId || courses[0]?.id));
    setClassNameInput('');
    setSubjectCodeInput(defaultCourse ? `${defaultCourse.code} ${defaultCourse.name}` : 'ท31101 การสื่อสารภาษาไทยร่วมสมัย');
    setFormSemester(defaultPeriod.semester);
    setFormYearCE(defaultPeriod.yearCE);
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
    if (!classNameInput.trim()) return;

    const academicYearStr = formatAcademicPeriod(formSemester, formYearCE, language);
    const parentCourse = courses.find((c) => c.id === selectedCourseForClass);

    if (editingClassroom) {
      await dataService.updateClassroom(editingClassroom.id, {
        course_id: selectedCourseForClass,
        course_name: parentCourse?.name,
        name: classNameInput.trim(),
        subject_code: subjectCodeInput.trim(),
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
        subject_code: subjectCodeInput.trim(),
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

    await dataService.addStudentToClassroom(managingClassroom.id, {
      first_name: newStudentFirst.trim(),
      last_name: newStudentLast.trim(),
      student_id: newStudentId.trim() || `541${Math.floor(10 + Math.random() * 90)}`,
      email: newStudentEmail.trim() || `${newStudentFirst.toLowerCase()}@student.pudding.ac.th`,
    });

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

  const getLiffUrl = (cls: Classroom) => {
    return `https://liff.line.me/2000000000-pudding?classId=${cls.id}&code=${cls.invite_code || 'PUD'}`;
  };

  const handleCopyLiff = (cls: Classroom) => {
    navigator.clipboard.writeText(getLiffUrl(cls));
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const handleSimulateLiffJoin = async () => {
    if (!managingClassroom) return;
    const names = [
      { first: 'นัทธมน', last: 'แก้วมณี', id: '54120', line: 'U8849a9...' },
      { first: 'ศุภโชค', last: 'รัตนสกุล', id: '54121', line: 'U1104b2...' },
      { first: 'อรอนงค์', last: 'บุญมี', id: '54122', line: 'U3391c7...' },
    ];
    const pick = names[Math.floor(Math.random() * names.length)];

    await dataService.addStudentToClassroom(managingClassroom.id, {
      first_name: pick.first,
      last_name: pick.last,
      student_id: pick.id,
      email: `${pick.first.toLowerCase()}@student.pudding.ac.th`,
      line_uid: pick.line,
    });

    showToast(
      language === 'th'
        ? `นักเรียน "${pick.first} ${pick.last}" เข้าร่วมห้องผ่าน LINE LIFF สำเร็จ!`
        : `Student "${pick.first} ${pick.last}" joined via LINE LIFF!`
    );
    await loadAllData();
  };

  // Open Learning Indicators Modal
  const handleOpenIndicatorsModal = (course: Course) => {
    setEditingCourseIndicators(course);
    setIndicatorListDraft(course.indicators || []);
    setIsIndicatorsModalOpen(true);
  };

  // Indicator reordering & weight adjustments
  const handleMoveIndicator = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= indicatorListDraft.length) return;

    const copy = [...indicatorListDraft];
    const temp = copy[index];
    copy[index] = copy[targetIndex];
    copy[targetIndex] = temp;

    // re-assign order_index
    const reordered = copy.map((ind, i) => ({ ...ind, order_index: i + 1 }));
    setIndicatorListDraft(reordered);
  };

  const handleIndicatorWeightChange = (index: number, weightVal: number) => {
    setIndicatorListDraft((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], weight: Math.max(0, Math.min(100, weightVal)) };
      return copy;
    });
  };

  const handleAddIndicatorDraft = () => {
    const nextNum = indicatorListDraft.length + 1;
    const newInd: CourseLearningIndicator = {
      id: `ind-${Date.now()}`,
      course_id: editingCourseIndicators?.id,
      code: `${editingCourseIndicators?.code || 'ค 1.1'} ม.4/${nextNum}`,
      title: 'ตัวชี้วัดและเกณฑ์มาตรฐานใหม่ตามประกาศกระทรวงศึกษาธิการ',
      weight: 20,
      order_index: nextNum,
    };
    setIndicatorListDraft([...indicatorListDraft, newInd]);
  };

  const handleDeleteIndicatorDraft = (index: number) => {
    if (indicatorListDraft.length <= 1) {
      alert(language === 'th' ? 'ต้องมีตัวชี้วัดอย่างน้อย 1 รายการ' : 'Must have at least one indicator');
      return;
    }
    setIndicatorListDraft(indicatorListDraft.filter((_, i) => i !== index));
  };

  const totalIndicatorsWeight = indicatorListDraft.reduce((acc, ind) => acc + (ind.weight || 0), 0);
  const isWeightBalanced = totalIndicatorsWeight === 100;

  const handleSaveIndicators = async () => {
    if (!editingCourseIndicators) return;
    await dataService.updateCourseIndicators(editingCourseIndicators.id, indicatorListDraft);
    showToast(
      language === 'th' ? 'บันทึกตัวชี้วัดและค่าน้ำหนักเรียบร้อยแล้ว' : 'Course indicators saved successfully'
    );
    setIsIndicatorsModalOpen(false);
    await loadAllData();
  };

  // Co-Teachers Setup
  const handleOpenCoTeachersModal = (course: Course) => {
    setEditingCourseCoTeachers(course);
    setCoTeachersDraft(course.teachers || []);
    setIsCoTeachersModalOpen(true);
  };

  const handleAddCoTeacher = () => {
    if (!newCoTeacherName.trim()) return;
    const newTeacher: ClassroomTeacher = {
      teacher_id: `teacher-${Date.now()}`,
      name: newCoTeacherName.trim(),
      email: newCoTeacherEmail.trim() || `${newCoTeacherName.toLowerCase()}@pudding.ac.th`,
      avatar_url: `https://images.unsplash.com/photo-${1534528741775 + Math.floor(Math.random() * 100)}?w=150`,
      role: 'assistant',
    };
    setCoTeachersDraft([...coTeachersDraft, newTeacher]);
    setNewCoTeacherName('');
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
            {classrooms.length}
          </p>
          <span className="text-[11px] text-amber-600 dark:text-amber-400 font-semibold mt-1 block">
            {formatAcademicPeriod(defaultPeriod.semester, defaultPeriod.yearCE, language)}
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
              <option value={`1_${defaultPeriod.yearCE}`}>
                {formatAcademicPeriod(1, defaultPeriod.yearCE, language)}{' '}
                {defaultPeriod.semester === 1 ? `(${t('classroom_mgmt.fields.active_semester')})` : ''}
              </option>
              <option value={`2_${defaultPeriod.yearCE}`}>
                {formatAcademicPeriod(2, defaultPeriod.yearCE, language)}{' '}
                {defaultPeriod.semester === 2 ? `(${t('classroom_mgmt.fields.active_semester')})` : ''}
              </option>
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
                  {language === "th" ? "ยังไม่มีรายวิชาในระบบ" : "No courses yet"}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  {language === "th"
                    ? "เริ่มต้นด้วยการสร้างรายวิชาแรกของคุณเพื่อจัดกลุ่มห้องเรียนและแบบทดสอบ"
                    : "Get started by creating your first course to group classrooms and assignments."}
                </p>
              </div>
              <button
                type="button"
                onClick={handleOpenCreateCourseModal}
                className="px-5 py-2.5 rounded-2xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs inline-flex items-center gap-2 shadow-sm transition-transform active:scale-95 cursor-pointer"
              >
                <PlusCircle className="w-4 h-4" />
                <span>+ {language === "th" ? "สร้างรายวิชาแรกของคุณ" : "Create First Course"}</span>
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

                {/* Course Control Actions: Rubrics, Co-Teachers, Add Section & Delete Course */}
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

                  {/* Learning Indicators & Rubrics Configuration */}
                  <button
                    type="button"
                    onClick={() => handleOpenIndicatorsModal(course)}
                    className="px-3.5 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5 cursor-pointer transition-colors"
                  >
                    <Sliders className="w-3.5 h-3.5 text-amber-500" />
                    <span>{t('dashboard.classrooms_section.course_settings_btn')}</span>
                  </button>

                  {/* Add Classroom Section Under This Course */}
                  <button
                    type="button"
                    onClick={() => handleOpenCreateClassModal(course.id)}
                    className="px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs flex items-center gap-1.5 cursor-pointer transition-colors shadow-xs"
                  >
                    <PlusCircle className="w-3.5 h-3.5" />
                    <span>+ {language === 'th' ? 'เพิ่มห้องเรียน' : 'Add Classroom'}</span>
                  </button>

                  {/* Delete Course Button */}
                  <button
                    type="button"
                    onClick={() => handleDeleteCourse(course)}
                    className="p-1.5 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 border border-transparent hover:border-rose-200 dark:hover:border-rose-900 transition-colors cursor-pointer"
                    title={language === 'th' ? `ลบรายวิชา ${course.code}` : `Delete Course ${course.code}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
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

                            <h4 className="font-bold text-sm text-slate-900 dark:text-white">
                              {cls.name}
                            </h4>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-1.5">
                              <Users className="w-3.5 h-3.5" />
                              <span>{count} {t('common.student')}</span>
                            </p>
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

            {/* Total Weight Validator Progress Bar */}
            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-700 dark:text-slate-300">
                  {t('indicators_config.total_weight')}:
                </span>
                <span
                  className={`font-black font-mono text-sm px-2.5 py-0.5 rounded-full ${
                    isWeightBalanced
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                      : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                  }`}
                >
                  {totalIndicatorsWeight}% / 100%
                </span>
              </div>
              <div className="w-full h-2.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                <div
                  className={`h-full transition-all ${
                    isWeightBalanced ? 'bg-emerald-500' : 'bg-rose-500'
                  }`}
                  style={{ width: `${Math.min(100, totalIndicatorsWeight)}%` }}
                />
              </div>
              <p
                className={`text-[11px] font-semibold ${
                  isWeightBalanced
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {isWeightBalanced
                  ? '✓ ' + t('indicators_config.weight_balanced')
                  : '⚠️ ' + t('indicators_config.weight_unbalanced').replace('{total}', String(totalIndicatorsWeight))}
              </p>
            </div>

            {/* Indicator Items List */}
            <div className="space-y-3">
              {indicatorListDraft.map((ind, idx) => (
                <div
                  key={ind.id}
                  className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 space-y-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-amber-500 text-slate-950 font-bold text-xs flex items-center justify-center font-mono">
                        {idx + 1}
                      </span>
                      <input
                        type="text"
                        value={ind.code}
                        onChange={(e) => {
                          const copy = [...indicatorListDraft];
                          copy[idx].code = e.target.value;
                          setIndicatorListDraft(copy);
                        }}
                        className="w-28 px-2 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-900 dark:text-white font-mono"
                      />
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Weight input */}
                      <div className="flex items-center gap-1 text-xs">
                        <span className="text-slate-400 font-semibold">{t('indicators_config.weight_label')}:</span>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={ind.weight}
                          onChange={(e) => handleIndicatorWeightChange(idx, Number(e.target.value))}
                          className="w-14 px-2 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-bold text-center font-mono text-slate-900 dark:text-white"
                        />
                        <span className="text-slate-400">%</span>
                      </div>

                      {/* Reorder Buttons */}
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => handleMoveIndicator(idx, 'up')}
                        className="p-1 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 disabled:opacity-30 hover:bg-slate-100"
                        title={t('indicators_config.move_up')}
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === indicatorListDraft.length - 1}
                        onClick={() => handleMoveIndicator(idx, 'down')}
                        className="p-1 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 disabled:opacity-30 hover:bg-slate-100"
                        title={t('indicators_config.move_down')}
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>

                      {/* Delete */}
                      <button
                        type="button"
                        onClick={() => handleDeleteIndicatorDraft(idx)}
                        className="p-1 rounded text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <input
                    type="text"
                    value={ind.title}
                    onChange={(e) => {
                      const copy = [...indicatorListDraft];
                      copy[idx].title = e.target.value;
                      setIndicatorListDraft(copy);
                    }}
                    placeholder={t('indicators_config.title_label')}
                    className="w-full px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white"
                  />
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={handleAddIndicatorDraft}
              className="w-full py-2.5 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <PlusCircle className="w-4 h-4 text-amber-500" />
              <span>{t('indicators_config.add_indicator')}</span>
            </button>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setIsIndicatorsModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
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
            className="bg-white dark:bg-slate-900 rounded-3xl max-w-lg w-full border border-slate-200 dark:border-slate-800 shadow-2xl p-6 space-y-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-amber-500" />
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  {t('courses.co_teachers')}
                </h3>
              </div>
              <button
                onClick={() => setIsCoTeachersModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Student Publication Notice Rule */}
            <div className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2">
              <ShieldCheck className="w-4 h-4 shrink-0 text-amber-600 mt-0.5" />
              <p className="leading-relaxed">
                {t('courses.co_teaching_rule_badge')}
              </p>
            </div>

            {/* Teachers List */}
            <div className="space-y-2.5">
              {coTeachersDraft.map((tchr) => (
                <div
                  key={tchr.teacher_id}
                  className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3">
                    <img
                      src={tchr.avatar_url || 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=100'}
                      alt=""
                      className="w-8 h-8 rounded-full object-cover"
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-xs text-slate-900 dark:text-white">
                          {tchr.name}
                        </span>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                            tchr.role === 'primary'
                              ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                              : 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                          }`}
                        >
                          {tchr.role === 'primary' ? 'Primary Owner' : 'Assistant / IRR'}
                        </span>
                      </div>
                      <span className="text-[11px] text-slate-400 font-mono">
                        {tchr.email}
                      </span>
                    </div>
                  </div>

                  {tchr.role !== 'primary' && (
                    <button
                      type="button"
                      onClick={() => handleRemoveCoTeacher(tchr.teacher_id)}
                      className="p-1.5 text-slate-400 hover:text-rose-500 rounded"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* Add New Assistant Teacher Form */}
            <div className="p-3.5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30 space-y-2.5">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 block">
                + {t('courses.add_co_teacher')}
              </span>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  value={newCoTeacherName}
                  onChange={(e) => setNewCoTeacherName(e.target.value)}
                  placeholder="ชื่อ-นามสกุล ครูผู้ช่วย"
                  className="px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white"
                />
                <input
                  type="email"
                  value={newCoTeacherEmail}
                  onChange={(e) => setNewCoTeacherEmail(e.target.value)}
                  placeholder="อีเมลโรงเรียน"
                  className="px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white"
                />
              </div>
              <button
                type="button"
                onClick={handleAddCoTeacher}
                className="w-full py-1.5 rounded-xl bg-slate-800 dark:bg-slate-700 hover:bg-slate-700 text-white text-xs font-bold"
              >
                + เพิ่มครูร่วมสอน
              </button>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setIsCoTeachersModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
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
                  value={selectedCourseForClass}
                  onChange={(e) => {
                    setSelectedCourseForClass(e.target.value);
                    const selCourse = courses.find((c) => c.id === e.target.value);
                    if (selCourse) {
                      setSubjectCodeInput(`${selCourse.code} ${selCourse.name}`);
                    }
                  }}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-900 dark:text-white focus:outline-hidden focus:border-amber-500 cursor-pointer"
                >
                  {courses.map((crs) => (
                    <option key={crs.id} value={crs.id}>
                      {crs.code} - {crs.name}
                    </option>
                  ))}
                </select>
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

              {/* Subject Code */}
              {/* <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  {t('classroom_mgmt.fields.subject_label')}
                </label>
                <input
                  type="text"
                  value={subjectCodeInput}
                  onChange={(e) => setSubjectCodeInput(e.target.value)}
                  placeholder={t('classroom_mgmt.fields.subject_placeholder')}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs focus:outline-hidden focus:border-amber-500 text-slate-900 dark:text-white"
                />
              </div> */}

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

            {/* LINE LIFF Invite Tab */}
            {studentTab === 'line' && (
              <div className="space-y-4 text-center p-4">
                <div className="w-12 h-12 rounded-2xl bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto">
                  <MessageCircle className="w-6 h-6" />
                </div>
                <h4 className="font-bold text-sm text-slate-900 dark:text-white">
                  {t('classroom_mgmt.invite_line_title')}
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                  {t('classroom_mgmt.invite_line_desc')}
                </p>

                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 font-mono text-xs text-slate-700 dark:text-slate-300 break-all select-all">
                  {getLiffUrl(managingClassroom)}
                </div>

                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleCopyLiff(managingClassroom)}
                    className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-xs"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>{isCopied ? t('classroom_mgmt.copied') : t('classroom_mgmt.copy_liff_link')}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleSimulateLiffJoin}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-xs"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>{t('classroom_mgmt.simulate_liff_join')}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
