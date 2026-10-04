'use client';

import { useUser } from '@clerk/nextjs';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { dataService } from '@/lib/supabase/dataService';
import { Classroom, User } from '@/types/database';
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
  Sparkles,
  ArrowLeft,
  X,
  UserPlus,
  Send,
} from 'lucide-react';

export default function ClassroomsPage() {
  const { user: clerkUser } = useUser();
  const { t, language } = useLanguage();
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal states
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingClassroom, setEditingClassroom] = useState<Classroom | null>(null);
  const [selectedClassroomForStudents, setSelectedClassroomForStudents] = useState<Classroom | null>(null);

  // Form states for create/edit
  const [classNameInput, setClassNameInput] = useState('');
  const [subjectCodeInput, setSubjectCodeInput] = useState('');
  const [academicYearInput, setAcademicYearInput] = useState('2567 / ภาคเรียนที่ 1');

  // Student management state
  const [studentActiveTab, setStudentActiveTab] = useState<'roster' | 'line' | 'email'>('roster');
  const [newStudentId, setNewStudentId] = useState('');
  const [newStudentFirstName, setNewStudentFirstName] = useState('');
  const [newStudentLastName, setNewStudentLastName] = useState('');
  const [newStudentEmail, setNewStudentEmail] = useState('');

  // Email invitation state
  const [emailInviteList, setEmailInviteList] = useState('');
  const [isCopied, setIsCopied] = useState(false);
  const [actionSuccessNotice, setActionSuccessNotice] = useState<string | null>(null);

  const showNotification = (msg: string) => {
    setActionSuccessNotice(msg);
    setTimeout(() => setActionSuccessNotice(null), 3000);
  };

  const loadData = async () => {
    try {
      const cls = await dataService.getClassrooms(clerkUser?.id);
      setClassrooms(cls);
      if (selectedClassroomForStudents) {
        const refreshed = cls.find((c) => c.id === selectedClassroomForStudents.id) || null;
        setSelectedClassroomForStudents(refreshed);
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

  const handleOpenCreateModal = () => {
    setEditingClassroom(null);
    setClassNameInput('');
    setSubjectCodeInput('ท31101 การสื่อสารภาษาไทยร่วมสมัย');
    setAcademicYearInput('2569 / ภาคเรียนที่ 1');
    setIsCreateModalOpen(true);
  };

  const handleOpenEditModal = (cls: Classroom) => {
    setEditingClassroom(cls);
    setClassNameInput(cls.name);
    setSubjectCodeInput(cls.subject_code || '');
    setAcademicYearInput(cls.academic_year);
    setIsCreateModalOpen(true);
  };

  const handleSaveClassroom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!classNameInput.trim()) return;

    if (editingClassroom) {
      await dataService.updateClassroom(editingClassroom.id, {
        name: classNameInput.trim(),
        subject_code: subjectCodeInput.trim(),
        academic_year: academicYearInput.trim(),
      });
      showNotification(language === 'th' ? 'แก้ไขข้อมูลห้องเรียนสำเร็จ' : 'Classroom updated successfully');
    } else {
      await dataService.createClassroom({
        teacher_id: clerkUser?.id || 'teacher-default',
        name: classNameInput.trim(),
        subject_code: subjectCodeInput.trim(),
        academic_year: academicYearInput.trim(),
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

  const handleAddStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClassroomForStudents || !newStudentFirstName || !newStudentLastName) return;

    await dataService.addStudentToClassroom(selectedClassroomForStudents.id, {
      first_name: newStudentFirstName.trim(),
      last_name: newStudentLastName.trim(),
      student_id: newStudentId.trim() || `541${Math.floor(10 + Math.random() * 90)}`,
      email: newStudentEmail.trim() || `${newStudentFirstName.toLowerCase()}@student.school.ac.th`,
    });

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

  // Generate LINE LIFF invite URL
  const getLiffUrl = (cls: Classroom) => {
    return `https://liff.line.me/2000000000-pudding?classId=${cls.id}&code=${cls.invite_code || 'PUD'}`;
  };

  const handleCopyLiff = (cls: Classroom) => {
    const url = getLiffUrl(cls);
    navigator.clipboard.writeText(url);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  // Simulate a student clicking the LINE LIFF link to join
  const handleSimulateLiffJoin = async () => {
    if (!selectedClassroomForStudents) return;
    const names = [
      { first: 'นัทธมน', last: 'แก้วมณี', id: '54120', line: 'U8849a9...' },
      { first: 'ศุภโชค', last: 'รัตนสกุล', id: '54121', line: 'U1104b2...' },
      { first: 'อรอนงค์', last: 'บุญมี', id: '54122', line: 'U3391c7...' },
    ];
    const pick = names[Math.floor(Math.random() * names.length)];

    await dataService.addStudentToClassroom(selectedClassroomForStudents.id, {
      first_name: pick.first,
      last_name: pick.last,
      student_id: pick.id,
      email: `${pick.first.toLowerCase()}@student.pudding.ac.th`,
      line_uid: pick.line,
    });

    showNotification(
      language === 'th'
        ? `นักเรียน "${pick.first} ${pick.last}" เข้าร่วมห้องผ่าน LINE LIFF สำเร็จ!`
        : `Student "${pick.first} ${pick.last}" joined via LINE LIFF!`
    );
    await loadData();
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

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  {t('classroom_mgmt.fields.year_label')}
                </label>
                <input
                  type="text"
                  value={academicYearInput}
                  onChange={(e) => setAcademicYearInput(e.target.value)}
                  placeholder={t('classroom_mgmt.fields.year_placeholder')}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs focus:outline-hidden focus:border-amber-500"
                />
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
                                    <span className="font-bold text-slate-900 dark:text-white block">
                                      {std.first_name} {std.last_name}
                                    </span>
                                    <span className="text-[11px] text-slate-400">{std.email}</span>
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

              {/* TAB 2: LINE LIFF Invitation */}
              {studentActiveTab === 'line' && (
                <div className="space-y-6">
                  <div className="p-5 rounded-2xl bg-gradient-to-br from-emerald-950/30 to-slate-900 border border-emerald-800/40 space-y-4">
                    <div className="flex items-start gap-3">
                      <div className="p-2.5 rounded-xl bg-emerald-500/20 text-emerald-400 shrink-0">
                        <MessageCircle className="w-6 h-6" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-white">
                          {t('classroom_mgmt.invite_line_title')}
                        </h4>
                        <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                          {t('classroom_mgmt.invite_line_desc')}
                        </p>
                      </div>
                    </div>

                    {/* QR Code & Invite Link Block */}
                    <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex flex-col sm:flex-row items-center gap-5">
                      <div className="p-3 bg-white rounded-xl shadow-md shrink-0">
                        <QrCode className="w-28 h-28 text-slate-900" />
                        <span className="text-[10px] text-center font-bold text-slate-800 block mt-1">
                          LINE LIFF QR
                        </span>
                      </div>

                      <div className="flex-1 space-y-3 w-full text-xs">
                        <div>
                          <span className="text-[11px] text-slate-400 font-semibold block mb-1">
                            ลิงก์คำเชิญ (LINE LIFF URL):
                          </span>
                          <div className="flex items-center gap-2 p-2 rounded-lg bg-slate-900 border border-slate-800 font-mono text-[11px] text-emerald-400 break-all">
                            <span>{getLiffUrl(selectedClassroomForStudents)}</span>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => handleCopyLiff(selectedClassroomForStudents)}
                            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center gap-1.5 transition-colors"
                          >
                            {isCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                            <span>{isCopied ? t('classroom_mgmt.copied') : t('classroom_mgmt.copy_liff_link')}</span>
                          </button>

                          <a
                            href={`https://line.me/R/share?text=${encodeURIComponent(
                              `เข้าร่วมห้องเรียน ${selectedClassroomForStudents.name} บน พุดดิ้ง (Pudding): ${getLiffUrl(
                                selectedClassroomForStudents
                              )}`
                            )}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-3 py-1.5 rounded-lg bg-[#06C755] hover:bg-[#05b34c] text-white font-bold flex items-center gap-1.5 transition-colors"
                          >
                            <Share2 className="w-3.5 h-3.5" />
                            <span>{t('classroom_mgmt.open_line_share')}</span>
                          </a>
                        </div>
                      </div>
                    </div>

                    {/* Simulation Button for Teacher Test */}
                    <div className="pt-2 border-t border-emerald-900/40 flex items-center justify-between">
                      <span className="text-xs text-slate-400">
                        {language === 'th'
                          ? 'สำหรับทดสอบ: กดเพื่อจำลองนักเรียนกดตอบรับผ่าน LINE LIFF'
                          : 'Testing tool: Click to simulate a student accepting the LINE LIFF invite'}
                      </span>
                      <button
                        type="button"
                        onClick={handleSimulateLiffJoin}
                        className="px-3.5 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition-all shadow-xs flex items-center gap-1.5 cursor-pointer"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>{t('classroom_mgmt.simulate_liff_join')}</span>
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
