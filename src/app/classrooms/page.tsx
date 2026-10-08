'use client';

import { useUser } from '@clerk/nextjs';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { dataService } from '@/lib/supabase/dataService';
import { Classroom, User } from '@/types/database';
import {
  getDefaultAcademicPeriod,
  formatAcademicPeriod,
  getAcademicYearOptions,
  formatSemesterLabel,
  parseAcademicPeriod,
} from '@/lib/utils/academicYear';
import {
  School,
  PlusCircle,
  Users,
  Edit2,
  Trash2,
  Share2,
  Copy,
  Check,
  Mail,
  MessageCircle,
  ExternalLink,
  QrCode,
  ArrowLeft,
  X,
  UserPlus,
  Send,
  UserCheck,
  UserX,
  CheckCircle2,
  Search,
  AlertCircle,
  Loader2,
  ShieldCheck,
} from 'lucide-react';
import { notificationManager } from '@/lib/utils/notificationManager';

export default function ClassroomsPage() {
  const { user: clerkUser } = useUser();
  const { t, language } = useLanguage();
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [loading, setLoading] = useState(true);

  // Compute default academic period
  const defaultPeriod = useMemo(() => getDefaultAcademicPeriod(), []);

  // Modal states
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingClassroom, setEditingClassroom] = useState<Classroom | null>(null);
  const [selectedClassroomForStudents, setSelectedClassroomForStudents] = useState<Classroom | null>(null);

  // Form states for create/edit
  const [classNameInput, setClassNameInput] = useState('');
  const [subjectCodeInput, setSubjectCodeInput] = useState('');
  const [formSemester, setFormSemester] = useState<number>(defaultPeriod.semester);
  const [formYearCE, setFormYearCE] = useState<number>(defaultPeriod.yearCE);

  // Teacher profile
  const [teacherProfile, setTeacherProfile] = useState<User | null>(null);

  // Student management state
  const [studentActiveTab, setStudentActiveTab] = useState<'roster' | 'pending' | 'line' | 'email'>('roster');
  const [newStudentId, setNewStudentId] = useState('');
  const [newStudentFirstName, setNewStudentFirstName] = useState('');
  const [newStudentLastName, setNewStudentLastName] = useState('');
  const [newStudentEmail, setNewStudentEmail] = useState('');

  // Autocomplete search student state
  const [studentSearchQuery, setStudentSearchQuery] = useState('');
  const [studentSearchResults, setStudentSearchResults] = useState<User[]>([]);
  const [isSearchingStudents, setIsSearchingStudents] = useState(false);

  // Email invitation state
  const [emailInviteList, setEmailInviteList] = useState('');
  const [isCopied, setIsCopied] = useState(false);
  const [actionSuccessNotice, setActionSuccessNotice] = useState<string | null>(null);

  const showNotification = (msg: string) => {
    setActionSuccessNotice(msg);
    setTimeout(() => setActionSuccessNotice(null), 3500);
  };

  const loadData = async () => {
    try {
      const cls = await dataService.getClassrooms(clerkUser?.id);
      setClassrooms(cls);
      if (selectedClassroomForStudents) {
        const refreshed = cls.find((c) => c.id === selectedClassroomForStudents.id) || null;
        setSelectedClassroomForStudents(refreshed);
      }
      if (clerkUser?.id) {
        const profile = await dataService.getUserById(clerkUser.id);
        if (profile) setTeacherProfile(profile);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [clerkUser?.id]);

  // Real-time synchronization for instant updates when students scan QR or join
  useEffect(() => {
    const unsub = dataService.subscribeToClassroomChanges(clerkUser?.id, (payload: any) => {
      loadData();
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
          showNotification(`🔔 มีคำขอใหม่: ${studentName} ขอเข้าห้องเรียน (รออนุมัติ)`);
        } else {
          notificationManager.add({
            title: 'นักเรียนเข้าห้องเรียนสำเร็จ',
            message: `นักเรียน ${studentName} ได้เข้าห้องเรียนแล้ว`,
            type: 'student_join',
          });
          showNotification(`🎉 ${studentName} ได้เข้าร่วมห้องเรียน`);
        }
      } else {
        showNotification(language === 'th' ? '🔄 อัปเดตข้อมูลห้องเรียนแบบ Realtime' : 'Classroom updated in realtime');
      }
    });

    return unsub;
  }, [clerkUser?.id, language]);

  const handleOpenCreateModal = () => {
    setEditingClassroom(null);
    setClassNameInput('');
    setSubjectCodeInput('ท31101 การสื่อสารภาษาไทยร่วมสมัย');
    setFormSemester(defaultPeriod.semester);
    setFormYearCE(defaultPeriod.yearCE);
    setIsCreateModalOpen(true);
  };

  const handleOpenEditModal = (cls: Classroom) => {
    setEditingClassroom(cls);
    setClassNameInput(cls.name);
    setSubjectCodeInput(cls.subject_code || '');
    setFormSemester(cls.semester || defaultPeriod.semester);
    setFormYearCE(cls.year_ce || defaultPeriod.yearCE);
    setIsCreateModalOpen(true);
  };

  const handleSaveClassroom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!classNameInput.trim()) return;

    const academicYearStr = formatAcademicPeriod(formSemester, formYearCE, language);

    if (editingClassroom) {
      await dataService.updateClassroom(editingClassroom.id, {
        name: classNameInput.trim(),
        subject_code: subjectCodeInput.trim(),
        academic_year: academicYearStr,
        semester: formSemester,
        year_ce: formYearCE,
      });
      showNotification(language === 'th' ? 'แก้ไขข้อมูลห้องเรียนสำเร็จ' : 'Classroom updated successfully');
    } else {
      await dataService.createClassroom({
        teacher_id: clerkUser?.id || 'teacher-default',
        name: classNameInput.trim(),
        subject_code: subjectCodeInput.trim(),
        academic_year: academicYearStr,
        semester: formSemester,
        year_ce: formYearCE,
      });
      showNotification(language === 'th' ? 'สร้างห้องเรียนใหม่สำเร็จ' : 'Classroom created successfully');
    }

    setIsCreateModalOpen(false);
    await loadData();
  };

  const handleDeleteClassroom = async (cls: Classroom) => {
    if (confirm(t('classroom_mgmt.delete_confirm'))) {
      await dataService.deleteClassroom(cls.id);
      showNotification(language === 'th' ? 'ลบห้องเรียนเรียบร้อย' : 'Classroom deleted');
      if (selectedClassroomForStudents?.id === cls.id) {
        setSelectedClassroomForStudents(null);
      }
      await loadData();
    }
  };

  // Student search autocomplete handler
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
    if (!selectedClassroomForStudents) return;
    await dataService.addStudentToClassroom(
      selectedClassroomForStudents.id,
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
    showNotification(language === 'th' ? `เพิ่ม ${std.first_name} ${std.last_name} สำเร็จ` : 'Student added');
    setStudentSearchQuery('');
    setStudentSearchResults([]);
    await loadData();
  };

  const handleAddStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClassroomForStudents || !newStudentFirstName.trim() || !newStudentLastName.trim()) return;

    const sid = newStudentId.trim();
    const fallbackEmail = sid
      ? `${sid}@student.pudding.ac.th`
      : `${newStudentFirstName.toLowerCase()}@student.pudding.ac.th`;

    await dataService.addStudentToClassroom(
      selectedClassroomForStudents.id,
      {
        first_name: newStudentFirstName.trim(),
        last_name: newStudentLastName.trim(),
        student_id: sid || undefined,
        email: newStudentEmail.trim() || fallbackEmail,
        institution: teacherProfile?.institution,
      },
      { autoAdmit: true }
    );

    setNewStudentFirstName('');
    setNewStudentLastName('');
    setNewStudentId('');
    setNewStudentEmail('');
    showNotification(language === 'th' ? 'เพิ่มนักเรียนเข้าห้องเรียนสำเร็จ' : 'Student added successfully');
    await loadData();
  };

  const handleRemoveStudent = async (studentId: string) => {
    if (!selectedClassroomForStudents) return;
    if (confirm(t('classroom_mgmt.remove_student_confirm'))) {
      await dataService.removeStudentFromClassroom(selectedClassroomForStudents.id, studentId);
      showNotification(language === 'th' ? 'นำนักเรียนออกจากห้องแล้ว' : 'Student removed');
      await loadData();
    }
  };

  const handleAdmitStudent = async (studentId: string) => {
    if (!selectedClassroomForStudents) return;
    try {
      await dataService.admitStudentToClassroom(selectedClassroomForStudents.id, studentId);
      showNotification(language === 'th' ? 'อนุมัตินักเรียนเข้าห้องเรียนเรียบร้อย' : 'Student admitted successfully');
      await loadData();
    } catch (err) {
      console.error(err);
      showNotification('เกิดข้อผิดพลาดในการอนุมัติ');
    }
  };

  const handleRejectStudent = async (studentId: string) => {
    if (!selectedClassroomForStudents) return;
    if (confirm(language === 'th' ? 'คุณต้องการปฏิเสธคำขอเข้าห้องเรียนนี้ใช่หรือไม่?' : 'Reject this join request?')) {
      try {
        await dataService.rejectStudentFromClassroom(selectedClassroomForStudents.id, studentId);
        showNotification(language === 'th' ? 'ปฏิเสธคำขอเข้าห้องเรียนแล้ว' : 'Student request rejected');
        await loadData();
      } catch (err) {
        console.error(err);
        showNotification('เกิดข้อผิดพลาดในการปฏิเสธคำขอ');
      }
    }
  };

  // Generate LINE LIFF invite URL
  const getLiffUrl = (cls: Classroom) => {
    const liffId = process.env.NEXT_PUBLIC_LINE_LIFF_ID || '2011818142-BznwnWyj';
    return `https://liff.line.me/${liffId}?classId=${cls.id}&code=${cls.invite_code || ''}`;
  };

  const getWebInviteUrl = (cls: Classroom) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}/liff?classId=${cls.id}&code=${cls.invite_code || ''}`;
  };

  const handleCopyLiff = (cls: Classroom) => {
    const url = getLiffUrl(cls);
    navigator.clipboard.writeText(url);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const handleSendEmailInvites = () => {
    if (!emailInviteList.trim()) return;
    showNotification(t('classroom_mgmt.email_sent_success'));
    setEmailInviteList('');
  };

  return (
    <div className="space-y-8 pb-16">
      {/* Toast Notice */}
      {actionSuccessNotice && (
        <div className="fixed bottom-6 right-6 z-50 p-4 rounded-2xl bg-emerald-900 text-white border border-emerald-700 shadow-2xl flex items-center gap-2 text-xs font-bold animate-in fade-in slide-in-from-bottom-5">
          <Check className="w-4 h-4 text-emerald-300" />
          <span>{actionSuccessNotice}</span>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-amber-600 transition-colors mb-2"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>{t('common.back')} {t('nav.dashboard')}</span>
          </Link>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
            {t('classroom_mgmt.title')}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {t('classroom_mgmt.subtitle')}
          </p>
        </div>

        <button
          type="button"
          onClick={handleOpenCreateModal}
          className="px-5 py-2.5 rounded-2xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs shadow-md shadow-amber-500/20 transition-all hover:scale-[1.02] flex items-center gap-2 cursor-pointer self-start sm:self-auto"
        >
          <PlusCircle className="w-4 h-4" />
          <span>{t('classroom_mgmt.create_class_modal_title')}</span>
        </button>
      </div>

      {/* Classrooms Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {classrooms.map((cls) => {
          const studentCount = cls.students ? cls.students.length : (cls.student_count || 0);

          return (
            <div
              key={cls.id}
              className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 shadow-xs hover:border-amber-400/60 dark:hover:border-amber-500/60 transition-all flex flex-col justify-between group"
            >
              <div>
                <div className="flex items-center justify-between text-xs text-slate-400 mb-3">
                  <span className="px-2.5 py-0.5 rounded-md bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 font-mono font-bold text-[11px] border border-amber-200/60 dark:border-amber-900/60">
                    {cls.invite_code || 'OMU'}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleOpenEditModal(cls)}
                      className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                      title={t('common.edit')}
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteClassroom(cls)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                      title={t('common.delete')}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <h3 className="font-bold text-base text-slate-900 dark:text-white leading-snug group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors">
                  {cls.name}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-1">
                  {cls.subject_code}
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {cls.academic_year}
                </p>
              </div>

              <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                  <Users className="w-4 h-4 text-amber-500" />
                  <span>{studentCount} {t('dashboard.classrooms_section.students_enrolled')}</span>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setSelectedClassroomForStudents(cls);
                    setStudentActiveTab('roster');
                  }}
                  className="px-3.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-900 dark:text-slate-100 text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <span>{t('dashboard.classrooms_section.view_class')}</span>
                  <Share2 className="w-3 h-3 text-amber-500" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Classroom Create / Edit Modal */}
      {isCreateModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in"
          onClick={() => setIsCreateModalOpen(false)}
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
                onClick={() => setIsCreateModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveClassroom} className="space-y-4">
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
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs focus:outline-hidden focus:border-amber-500 font-medium"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  {t('classroom_mgmt.fields.subject_label')}
                </label>
                <input
                  type="text"
                  value={subjectCodeInput}
                  onChange={(e) => setSubjectCodeInput(e.target.value)}
                  placeholder={t('classroom_mgmt.fields.subject_placeholder')}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs focus:outline-hidden focus:border-amber-500"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center justify-between">
                  <span>{t('classroom_mgmt.fields.year_label')} *</span>
                  <span className="text-[11px] text-amber-600 dark:text-amber-400 font-mono">
                    {formatAcademicPeriod(formSemester, formYearCE, language)}
                  </span>
                </label>

                {/* Semester selection */}
                <div className="grid grid-cols-3 gap-2">
                  {[1, 2, 3].map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setFormSemester(s)}
                      className={`py-2 px-2 rounded-xl text-xs font-bold border transition-all cursor-pointer flex flex-col items-center justify-center ${
                        formSemester === s
                          ? 'bg-amber-500 text-slate-950 border-amber-500 shadow-xs'
                          : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100'
                      }`}
                    >
                      <span>{s === 3 ? (language === 'th' ? 'ซัมเมอร์' : 'Summer') : `${language === 'th' ? 'ภาคเรียนที่' : 'Semester'} ${s}`}</span>
                    </button>
                  ))}
                </div>

                {/* Year Selection */}
                <div className="flex items-center gap-2 pt-1">
                  <span className="text-xs text-slate-500 font-medium shrink-0">
                    {language === 'th' ? 'ปีการศึกษา:' : 'Academic Year:'}
                  </span>
                  <div className="grid grid-cols-3 gap-1.5 flex-1">
                    {getAcademicYearOptions(defaultPeriod.yearCE).map((yr) => (
                      <button
                        key={yr}
                        type="button"
                        onClick={() => setFormYearCE(yr)}
                        className={`py-1.5 px-2 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                          formYearCE === yr
                            ? 'bg-amber-500 text-slate-950 border-amber-500 font-black'
                            : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        {yr + 543} ({yr})
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-4">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs shadow-md shadow-amber-500/20"
                >
                  {t('common.save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Classroom Student Roster & Invites Drawer / Modal */}
      {selectedClassroomForStudents && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-xs animate-in fade-in"
          onClick={() => setSelectedClassroomForStudents(null)}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-3xl max-w-3xl w-full border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/80 dark:bg-slate-950/80">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-black text-slate-900 dark:text-white">
                    {selectedClassroomForStudents.name}
                  </h3>
                  <span className="px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 font-mono text-xs font-bold">
                    {selectedClassroomForStudents.invite_code || 'OMU'}
                  </span>
                </div>
                <p className="text-xs text-slate-400">
                  {selectedClassroomForStudents.subject_code} • {selectedClassroomForStudents.academic_year}
                </p>
              </div>

              <button
                onClick={() => setSelectedClassroomForStudents(null)}
                className="p-2 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Tabs Bar */}
            <div className="flex border-b border-slate-200 dark:border-slate-800 px-6 bg-white dark:bg-slate-900 gap-4 text-xs font-bold">
              <button
                onClick={() => setStudentActiveTab('roster')}
                className={`py-3 border-b-2 flex items-center gap-1.5 transition-colors cursor-pointer ${
                  studentActiveTab === 'roster'
                    ? 'border-amber-500 text-amber-600 dark:text-amber-400'
                    : 'border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Users className="w-4 h-4" />
                <span>{t('classroom_mgmt.students_tab')} ({selectedClassroomForStudents.students?.length || 0})</span>
              </button>

              <button
                onClick={() => setStudentActiveTab('pending')}
                className={`py-3 border-b-2 flex items-center gap-1.5 transition-colors cursor-pointer ${
                  studentActiveTab === 'pending'
                    ? 'border-amber-500 text-amber-600 dark:text-amber-400'
                    : 'border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <UserCheck className="w-4 h-4 text-amber-500" />
                <span>{language === 'th' ? 'คำขอรออนุมัติ (Admit)' : 'Pending Admit'}</span>
                {(selectedClassroomForStudents.pending_students?.length || 0) > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full bg-rose-500 text-white text-[10px] font-black animate-pulse">
                    {selectedClassroomForStudents.pending_students?.length}
                  </span>
                )}
              </button>

              <button
                onClick={() => setStudentActiveTab('line')}
                className={`py-3 border-b-2 flex items-center gap-1.5 transition-colors cursor-pointer ${
                  studentActiveTab === 'line'
                    ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400'
                    : 'border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <MessageCircle className="w-4 h-4 text-emerald-500" />
                <span>{language === 'th' ? 'เชิญผ่าน LINE LIFF' : 'LINE LIFF Invite'}</span>
              </button>

              <button
                onClick={() => setStudentActiveTab('email')}
                className={`py-3 border-b-2 flex items-center gap-1.5 transition-colors cursor-pointer ${
                  studentActiveTab === 'email'
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Mail className="w-4 h-4 text-blue-500" />
                <span>{language === 'th' ? 'เชิญผ่านอีเมล' : 'Email Invite'}</span>
              </button>
            </div>

            {/* Tab Body */}
            <div className="p-6 overflow-y-auto space-y-6">
              {/* TAB 1: Roster */}
              {studentActiveTab === 'roster' && (
                <div className="space-y-6">
                  {/* Quick Search & Auto-complete to Add Existing Student */}
                  <div className="p-4 rounded-2xl bg-amber-500/5 dark:bg-amber-500/10 border border-amber-200/80 dark:border-amber-800/40 space-y-2 relative">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-amber-900 dark:text-amber-300 flex items-center gap-1.5">
                        <Search className="w-3.5 h-3.5 text-amber-500" />
                        <span>{language === 'th' ? 'ค้นหาและเพิ่มนักเรียนด่วน (จากสถานศึกษาเดียวกัน/ระบบ)' : 'Quick Search & Add Student'}</span>
                      </span>
                      {teacherProfile?.institution && (
                        <span className="text-[10px] text-amber-700/80 dark:text-amber-400 font-medium">
                          🏫 {teacherProfile.institution}
                        </span>
                      )}
                    </div>
                    <div className="relative">
                      <input
                        type="text"
                        value={studentSearchQuery}
                        onChange={(e) => handleSearchStudents(e.target.value)}
                        placeholder={language === 'th' ? "พิมพ์ชื่อ นามสกุล หรือ รหัสนักเรียน เพื่อค้นหา..." : "Search by name or student ID..."}
                        className="w-full pl-9 pr-9 py-2 rounded-xl bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-900/60 text-xs font-medium focus:outline-hidden focus:border-amber-500"
                      />
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                      {isSearchingStudents && (
                        <Loader2 className="w-3.5 h-3.5 text-amber-500 animate-spin absolute right-3 top-2.5" />
                      )}
                    </div>

                    {/* Search Results Dropdown */}
                    {studentSearchResults.length > 0 && (
                      <div className="absolute left-4 right-4 top-full mt-1 z-30 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl max-h-52 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                        {studentSearchResults.map((std) => (
                          <div
                            key={std.id}
                            onClick={() => handleSelectFoundStudent(std)}
                            className="p-2.5 hover:bg-amber-50 dark:hover:bg-amber-950/30 cursor-pointer flex items-center justify-between transition-colors"
                          >
                            <div className="flex items-center gap-2.5">
                              <img
                                src={std.avatar_url || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100'}
                                alt=""
                                className="w-7 h-7 rounded-full object-cover ring-1 ring-amber-400/40"
                              />
                              <div>
                                <span className="font-bold text-xs text-slate-900 dark:text-white block">
                                  {`${std.first_name || ''} ${std.last_name || ''}`.trim() || std.name}
                                  {std.student_id ? ` (ID: ${std.student_id})` : ''}
                                </span>
                                <span className="text-[10px] text-slate-400">
                                  {std.institution || std.email}
                                </span>
                              </div>
                            </div>
                            <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-950/60 px-2 py-0.5 rounded-full flex items-center gap-1">
                              <PlusCircle className="w-3 h-3" />
                              <span>เพิ่มเข้าห้อง</span>
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Add Student Form */}
                  <form
                    onSubmit={handleAddStudent}
                    className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/80 space-y-3"
                  >
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                      <UserPlus className="w-3.5 h-3.5 text-amber-500" />
                      <span>{t('classroom_mgmt.add_student_manual')}</span>
                    </span>

                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
                      <input
                        type="text"
                        placeholder="รหัส นร."
                        value={newStudentId}
                        onChange={(e) => setNewStudentId(e.target.value)}
                        className="px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-medium"
                      />
                      <input
                        type="text"
                        required
                        placeholder="ชื่อจริง *"
                        value={newStudentFirstName}
                        onChange={(e) => setNewStudentFirstName(e.target.value)}
                        className="px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-medium"
                      />
                      <input
                        type="text"
                        required
                        placeholder="นามสกุล *"
                        value={newStudentLastName}
                        onChange={(e) => setNewStudentLastName(e.target.value)}
                        className="px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-medium"
                      />
                      <button
                        type="submit"
                        className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs shadow-xs transition-colors flex items-center justify-center gap-1 cursor-pointer"
                      >
                        <PlusCircle className="w-3.5 h-3.5" />
                        <span>เพิ่ม</span>
                      </button>
                    </div>
                  </form>

                  {/* Student Table */}
                  <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-bold border-b border-slate-200/60 dark:border-slate-800">
                        <tr>
                          <th className="py-3 px-4">{t('classroom_mgmt.student_id')}</th>
                          <th className="py-3 px-4">{t('classroom_mgmt.student_name')}</th>
                          <th className="py-3 px-4">{t('classroom_mgmt.line_status')}</th>
                          <th className="py-3 px-4 text-right">{t('common.actions')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
                        {(!selectedClassroomForStudents.students || selectedClassroomForStudents.students.length === 0) ? (
                          <tr>
                            <td colSpan={4} className="py-8 text-center text-slate-400">
                              {language === 'th'
                                ? 'ยังไม่มีนักเรียนในห้องนี้ ใช้ LINE LIFF หรือแบบฟอร์มด้านบนเพื่อเชิญนักเรียน'
                                : 'No students enrolled yet. Use LINE LIFF or the form above to add students.'}
                            </td>
                          </tr>
                        ) : (
                          selectedClassroomForStudents.students.map((std) => (
                            <tr key={std.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                              <td className="py-3 px-4 font-mono text-slate-500 dark:text-slate-400">
                                {std.student_id || '-'}
                              </td>
                              <td className="py-3 px-4">
                                <div className="flex items-center gap-2.5">
                                  <img
                                    src={std.avatar_url || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100'}
                                    alt=""
                                    className="w-6 h-6 rounded-full object-cover"
                                  />
                                  <div>
                                    <div className="flex items-center gap-2">
                                      <span className="font-bold text-slate-900 dark:text-white block">
                                        {std.first_name && std.last_name
                                          ? `${std.first_name} ${std.last_name}`
                                          : std.name || 'นักเรียน'}
                                      </span>
                                      {std.name && std.first_name && std.name.trim() !== `${std.first_name} ${std.last_name}`.trim() && (
                                        <span className="text-[10px] text-emerald-700 dark:text-emerald-400 font-semibold px-1.5 py-0.2 bg-emerald-50 dark:bg-emerald-950/60 rounded border border-emerald-200/60 dark:border-emerald-800/60">
                                          LINE: {std.name}
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5">
                                      <span>{std.email}</span>
                                      {std.institution && (
                                        <span>• 🏫 {std.institution}</span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </td>
                              <td className="py-3 px-4">
                                {std.line_uid ? (
                                  <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded-full">
                                    <Check className="w-3 h-3" />
                                    {t('classroom_mgmt.line_connected')}
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-[11px] text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">
                                    {t('classroom_mgmt.line_pending')}
                                  </span>
                                )}
                              </td>
                              <td className="py-3 px-4 text-right">
                                <button
                                  type="button"
                                  onClick={() => handleRemoveStudent(std.id)}
                                  className="text-slate-400 hover:text-rose-600 p-1.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                                  title={t('common.delete')}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* TAB: Pending Approval (Admit) */}
              {studentActiveTab === 'pending' && (
                <div className="space-y-4">
                  <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2.5">
                    <ShieldCheck className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                    <p className="leading-relaxed">
                      {language === 'th'
                        ? 'ระบบความปลอดภัยตรวจสอบการเข้าห้องเรียน: นักเรียนที่สแกน QR Code หรือเข้าผ่านรหัสจะอยู่ในสถานะรอการอนุมัติ (Admit) ก่อน เพื่อป้องกันผู้ไม่หวังดีเข้ามาปั่นในห้องเรียน'
                        : 'Classroom Admission Gate: Students who scan QR codes or join via invite link remain in pending approval until admitted by the teacher.'}
                    </p>
                  </div>

                  {(!selectedClassroomForStudents.pending_students || selectedClassroomForStudents.pending_students.length === 0) ? (
                    <div className="py-12 text-center text-xs text-slate-400 space-y-2">
                      <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-400 flex items-center justify-center mx-auto text-xl">
                        ✅
                      </div>
                      <p className="font-medium text-slate-600 dark:text-slate-300">
                        {language === 'th' ? 'ไม่มีคำขอเข้าห้องเรียนที่รอการอนุมัติในขณะนี้' : 'No pending admission requests at this time.'}
                      </p>
                      <p className="text-[11px] text-slate-400">
                        {language === 'th' ? 'เมื่อนักเรียนสแกน QR Code หน้าจอนี้จะอัปเดตแบบ Real-time ทันที' : 'When students scan the QR code, this list updates automatically in real-time.'}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {selectedClassroomForStudents.pending_students.map((std) => (
                        <div
                          key={std.id}
                          className="p-3.5 rounded-2xl bg-white dark:bg-slate-800 border border-amber-200 dark:border-amber-900/60 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                        >
                          <div className="flex items-center gap-3">
                            <img
                              src={std.avatar_url || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100'}
                              alt=""
                              className="w-10 h-10 rounded-2xl object-cover ring-2 ring-amber-400 shrink-0"
                            />
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-xs text-slate-900 dark:text-white">
                                  {std.first_name && std.last_name
                                    ? `${std.first_name} ${std.last_name}`
                                    : std.name || 'นักเรียน'}
                                </span>
                                {std.student_id && (
                                  <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                                    ID: {std.student_id}
                                  </span>
                                )}
                                {std.name && std.first_name && std.name.trim() !== `${std.first_name} ${std.last_name}`.trim() && (
                                  <span className="text-[10px] text-emerald-700 dark:text-emerald-400 font-semibold px-1.5 py-0.2 bg-emerald-50 dark:bg-emerald-950/60 rounded">
                                    LINE: {std.name}
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

              {/* TAB 2: LINE LIFF Invitation */}
              {studentActiveTab === 'line' && (
                <div className="space-y-6">
                  <div className="p-5 rounded-2xl bg-gradient-to-br from-emerald-950/30 to-slate-900 border border-emerald-800/40 space-y-5 text-center">
                    <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto shadow-xs">
                      <MessageCircle className="w-6 h-6" />
                    </div>
                    <div>
                      <h4 className="text-base font-bold text-white">
                        {t('classroom_mgmt.invite_line_title')}
                      </h4>
                      <p className="text-xs text-slate-300 mt-1 max-w-md mx-auto leading-relaxed">
                        {t('classroom_mgmt.invite_line_desc')}
                      </p>
                    </div>

                    {/* Classroom Invite Code */}
                    {selectedClassroomForStudents.invite_code && (
                      <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 max-w-sm mx-auto flex items-center justify-between text-left">
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-wider text-amber-400">
                            {language === 'th' ? 'รหัสเข้าห้องเรียน' : 'Classroom Code'}
                          </div>
                          <div className="text-xl font-black font-mono tracking-widest text-white">
                            {selectedClassroomForStudents.invite_code}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(selectedClassroomForStudents.invite_code || '');
                            setIsCopied(true);
                            setTimeout(() => setIsCopied(false), 2000);
                          }}
                          className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-bold text-white border border-white/10 flex items-center gap-1 cursor-pointer"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          <span>{isCopied ? t('classroom_mgmt.copied') : (language === 'th' ? 'คัดลอกรหัส' : 'Copy')}</span>
                        </button>
                      </div>
                    )}

                    {/* Real Scannable QR Code */}
                    <div className="flex flex-col items-center justify-center gap-2">
                      <div className="p-3 bg-white rounded-2xl shadow-lg border border-emerald-500/30 inline-block">
                        <img
                          src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(getLiffUrl(selectedClassroomForStudents))}`}
                          alt="LINE LIFF QR Code"
                          className="w-40 h-40 object-contain rounded-lg"
                        />
                      </div>
                      <span className="text-[11px] text-slate-400 font-medium">
                        {language === 'th' ? 'สแกน QR ด้วยแอป LINE เพื่อเข้าห้องเรียนทันที' : 'Scan with LINE app to join immediately'}
                      </span>
                    </div>

                    {/* Real LIFF URL Display */}
                    <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 font-mono text-xs text-emerald-400 break-all select-all max-w-lg mx-auto">
                      {getLiffUrl(selectedClassroomForStudents)}
                    </div>

                    {/* Action Buttons */}
                    <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
                      <button
                        type="button"
                        onClick={() => handleCopyLiff(selectedClassroomForStudents)}
                        className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-xs"
                      >
                        {isCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{isCopied ? t('classroom_mgmt.copied') : t('classroom_mgmt.copy_liff_link')}</span>
                      </button>

                      <a
                        href={`https://line.me/R/msg/text/?${encodeURIComponent(
                          `${language === 'th' ? 'เข้าร่วมห้องเรียน Pudding' : 'Join Pudding Classroom'}: ${selectedClassroomForStudents.name}\n\nกดลิงก์นี้ใน LINE: ${getLiffUrl(
                            selectedClassroomForStudents
                          )}\nรหัสห้องเรียน: ${selectedClassroomForStudents.invite_code || ''}`
                        )}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-4 py-2 rounded-xl bg-[#06C755] hover:bg-[#05b34c] text-white font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer inline-flex"
                      >
                        <Share2 className="w-3.5 h-3.5" />
                        <span>{language === 'th' ? 'แชร์เข้าแชท LINE' : 'Share to LINE'}</span>
                      </a>

                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(getWebInviteUrl(selectedClassroomForStudents));
                          setIsCopied(true);
                          setTimeout(() => setIsCopied(false), 2000);
                        }}
                        className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
                      >
                        <Copy className="w-3 h-3" />
                        <span>{language === 'th' ? 'คัดลอกลิงก์เว็บตรง' : 'Copy Web Link'}</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 3: Email Invitation */}
              {studentActiveTab === 'email' && (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                      {t('classroom_mgmt.invite_email_desc')}
                    </label>
                    <textarea
                      rows={4}
                      value={emailInviteList}
                      onChange={(e) => setEmailInviteList(e.target.value)}
                      placeholder={t('classroom_mgmt.invite_email_placeholder')}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs focus:outline-hidden focus:border-amber-500 font-mono leading-relaxed"
                    />
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={handleSendEmailInvites}
                      className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs shadow-md shadow-amber-500/20 flex items-center gap-1.5 cursor-pointer"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>{t('classroom_mgmt.send_email_invites')}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedClassroomForStudents(null)}
                className="px-4 py-2 rounded-xl bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white text-xs font-bold"
              >
                {t('common.close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
