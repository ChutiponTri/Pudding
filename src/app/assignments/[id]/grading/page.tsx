'use client';

import React, { useState, useEffect, use } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { dataService } from '@/lib/supabase/dataService';
import {
  Assignment,
  Question,
  Submission,
  SubmissionAnswer,
  SubmissionEvent,
  SubmissionOverrideStatus,
  TeacherRole,
} from '@/types/database';
import { AntiCheatingBadge } from '@/components/AntiCheatingBadge';
import { IntegrityAuditModal } from '@/components/IntegrityAuditModal';
import { GradingWorkspace } from '@/components/GradingWorkspace';
import {
  Search,
  Filter,
  ShieldAlert,
  Clock,
  CheckCircle2,
  AlertTriangle,
  ArrowLeft,
  Award,
  ChevronRight,
  ExternalLink,
  Sparkles,
  UserCheck,
  FileText,
  Lock,
  Unlock,
  RotateCcw,
  Check,
  Calendar,
  Layers,
} from 'lucide-react';

export default function GradingPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const assignmentId = resolvedParams.id;

  const { t, language } = useLanguage();

  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters & Search
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'suspicious' | 'pending' | 'graded'>('all');

  // Audit modal state
  const [auditSubmission, setAuditSubmission] = useState<Submission | null>(null);
  const [auditEvents, setAuditEvents] = useState<SubmissionEvent[]>([]);
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);

  // Grading workspace modal state
  const [gradingSubmission, setGradingSubmission] = useState<Submission | null>(null);
  const [gradingAnswers, setGradingAnswers] = useState<Record<string, SubmissionAnswer>>({});
  const [isGradingWorkspaceOpen, setIsGradingWorkspaceOpen] = useState(false);

  // Manual Submission Control Panel State
  const [overrideStatus, setOverrideStatus] = useState<SubmissionOverrideStatus>('auto');
  const [extendedDateTime, setExtendedDateTime] = useState('');
  const [showExtendPicker, setShowExtendPicker] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const loadAllData = async () => {
    try {
      const { assignment: asg, questions: qs } = await dataService.getAssignmentById(assignmentId);
      setAssignment(asg);
      setQuestions(qs);
      if (asg) {
        setOverrideStatus(asg.status_override || 'auto');
        if (asg.extended_until) {
          setExtendedDateTime(asg.extended_until);
        } else {
          // default 2 days in future
          const nextTwoDays = new Date(Date.now() + 2 * 86400000);
          setExtendedDateTime(nextTwoDays.toISOString().slice(0, 16));
        }
      }

      const subs = await dataService.getSubmissions(assignmentId);
      setSubmissions(subs);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAllData();
  }, [assignmentId]);

  // Handle Manual Override
  const handleSetOverride = async (newStatus: SubmissionOverrideStatus, newExtendedUntil?: string) => {
    try {
      const updated = await dataService.updateAssignmentDeadlineOverride(assignmentId, {
        status_override: newStatus,
        extended_until: newExtendedUntil || (newStatus === 'extended' ? extendedDateTime : undefined),
      });

      if (updated) {
        setAssignment(updated);
        setOverrideStatus(newStatus);
      }

      if (newStatus === 'force_closed') {
        showToast(language === 'th' ? 'บังคับปิดรับงานทันทีเรียบร้อยแล้ว' : 'Submissions force-closed immediately');
        setShowExtendPicker(false);
      } else if (newStatus === 'extended') {
        showToast(language === 'th' ? 'ขยายเวลาส่งงานเรียบร้อยแล้ว' : 'Deadline extended successfully');
        setShowExtendPicker(false);
      } else {
        showToast(language === 'th' ? 'กลับสู่โหมดกำหนดส่งอัตโนมัติ' : 'Reset to automated deadline schedule');
        setShowExtendPicker(false);
      }
    } catch (err) {
      console.error(err);
      alert('Error updating deadline override');
    }
  };

  // Open Integrity Audit Modal
  const handleOpenAudit = async (submission: Submission) => {
    setAuditSubmission(submission);
    try {
      const events = await dataService.getSubmissionEvents(submission.id);
      setAuditEvents(events);
    } catch {
      setAuditEvents([]);
    }
    setIsAuditModalOpen(true);
  };

  // Open Grading Workspace
  const handleOpenGrading = async (submission: Submission) => {
    setGradingSubmission(submission);
    try {
      const answers = await dataService.getSubmissionAnswers(submission.id);
      setGradingAnswers(answers);
    } catch {
      setGradingAnswers({});
    }
    setIsGradingWorkspaceOpen(true);
  };

  // Next Student in Workspace
  const handleNextStudent = async () => {
    if (!gradingSubmission) return;
    const currentIndex = submissions.findIndex((s) => s.id === gradingSubmission.id);
    if (currentIndex >= 0 && currentIndex < submissions.length - 1) {
      const nextSub = submissions[currentIndex + 1];
      await handleOpenGrading(nextSub);
    } else {
      setIsGradingWorkspaceOpen(false);
    }
  };

  // Filter Submissions
  const filteredSubmissions = submissions.filter((sub) => {
    const studentName = `${sub.student?.first_name || ''} ${sub.student?.last_name || ''}`;
    const studentId = sub.student?.student_id || sub.student_id;
    const matchesSearch =
      studentName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      studentId.toLowerCase().includes(searchTerm.toLowerCase());

    if (!matchesSearch) return false;

    if (statusFilter === 'suspicious') {
      return sub.is_flagged_suspicious || sub.tab_switch_count >= 3 || sub.total_time_away_seconds >= 60;
    }
    if (statusFilter === 'pending') {
      return sub.total_score === undefined;
    }
    if (statusFilter === 'graded') {
      return sub.total_score !== undefined;
    }

    return true;
  });

  const suspiciousTotal = submissions.filter(
    (s) => s.is_flagged_suspicious || s.tab_switch_count >= 3 || s.total_time_away_seconds >= 60
  ).length;

  const gradedTotal = submissions.filter((s) => s.total_score !== undefined).length;

  return (
    <div className="space-y-8 pb-20">
      {/* Toast Notice */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 p-4 rounded-2xl bg-amber-500 text-slate-950 font-bold shadow-2xl flex items-center gap-2 text-xs animate-in fade-in slide-in-from-bottom-5">
          <Check className="w-4 h-4" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Breadcrumb & Assignment Header */}
      <div className="space-y-4">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-amber-600 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>{t('common.back')} {t('nav.dashboard')}</span>
        </Link>

        <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span
                  className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                    assignment?.is_exam
                      ? 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300'
                      : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                  }`}
                >
                  {assignment?.is_exam
                    ? t('assignment_creator.mode_exam')
                    : t('assignment_creator.mode_assignment')}
                </span>
                <span className="text-xs text-slate-400 font-mono">
                  {assignment?.classroom_name || 'มัธยมศึกษาปีที่ 4/1'}
                </span>
                {assignment?.sample_work_title && (
                  <span className="px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 text-[11px] font-semibold border border-blue-200 dark:border-blue-900/50">
                    📎 {assignment.sample_work_title}
                  </span>
                )}
              </div>

              <h1 className="text-xl md:text-2xl font-black text-slate-900 dark:text-white">
                {assignment?.title || t('grading.title')}
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                {assignment?.description || '-'}
              </p>
            </div>

            <div className="flex items-center gap-4">
              <div className="text-right">
                <span className="text-xs text-slate-400 block font-medium">
                  {t('grading.due_date')}
                </span>
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200 font-mono">
                  {assignment?.due_date
                    ? new Date(assignment.due_date).toLocaleDateString(language === 'th' ? 'th-TH' : 'en-US', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : '-'}
                </span>
              </div>
            </div>
          </div>

          {/* INTERACTIVE MANUAL SUBMISSION CONTROL PANEL */}
          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-amber-500/20 text-amber-600 dark:text-amber-400">
                  <Clock className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-slate-900 dark:text-white">
                    {t('submission_control.title')}
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {t('submission_control.subtitle')}
                  </p>
                </div>
              </div>

              {/* Status Action Buttons */}
              <div className="flex items-center gap-2">
                {/* 1. Automated */}
                <button
                  type="button"
                  onClick={() => handleSetOverride('auto')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                    overrideStatus === 'auto'
                      ? 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 border border-emerald-500/50 shadow-xs'
                      : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  <Clock className="w-3.5 h-3.5" />
                  <span>{t('submission_control.mode_auto')}</span>
                </button>

                {/* 2. Force Close Immediately */}
                <button
                  type="button"
                  onClick={() => handleSetOverride('force_closed')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                    overrideStatus === 'force_closed'
                      ? 'bg-rose-600 text-white shadow-xs'
                      : 'text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60'
                  }`}
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>{t('submission_control.btn_force_close')}</span>
                </button>

                {/* 3. Re-open / Extend Deadline */}
                <button
                  type="button"
                  onClick={() => setShowExtendPicker(!showExtendPicker)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                    overrideStatus === 'extended'
                      ? 'bg-amber-500 text-slate-950 shadow-xs'
                      : 'text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40 border border-amber-300 dark:border-amber-900/60'
                  }`}
                >
                  <Unlock className="w-3.5 h-3.5" />
                  <span>{t('submission_control.btn_reopen')}</span>
                </button>
              </div>
            </div>

            {/* Extend Date-Time Picker Drawer */}
            {showExtendPicker && (
              <div className="pt-2 border-t border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row sm:items-center gap-3 animate-in fade-in">
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-amber-500" />
                  <span>{t('submission_control.extend_date_label')}:</span>
                </span>
                <input
                  type="datetime-local"
                  value={extendedDateTime}
                  onChange={(e) => setExtendedDateTime(e.target.value)}
                  className="px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-900 dark:text-white"
                />
                <button
                  type="button"
                  onClick={() => handleSetOverride('extended', extendedDateTime)}
                  className="px-4 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs shadow-xs cursor-pointer"
                >
                  {language === 'th' ? 'บันทึกเวลาขยาย' : 'Apply Extension'}
                </button>
              </div>
            )}

            {/* Current Active Status Indicator Banner */}
            <div
              className={`px-3.5 py-2 rounded-xl text-xs font-medium flex items-center justify-between ${
                overrideStatus === 'force_closed'
                  ? 'bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-200 border border-rose-200 dark:border-rose-900/60'
                  : overrideStatus === 'extended'
                  ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200 border border-amber-200 dark:border-amber-900/60'
                  : 'bg-emerald-100/70 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-900/50'
              }`}
            >
              <div className="flex items-center gap-2">
                {overrideStatus === 'force_closed' && <Lock className="w-4 h-4 text-rose-600" />}
                {overrideStatus === 'extended' && <Unlock className="w-4 h-4 text-amber-600" />}
                {overrideStatus === 'auto' && <Clock className="w-4 h-4 text-emerald-600" />}
                <span>
                  {overrideStatus === 'force_closed'
                    ? t('submission_control.status_banner_closed')
                    : overrideStatus === 'extended'
                    ? t('submission_control.status_banner_extended').replace(
                        '{time}',
                        assignment?.extended_until
                          ? new Date(assignment.extended_until).toLocaleString(language === 'th' ? 'th-TH' : 'en-US')
                          : extendedDateTime
                      )
                    : t('submission_control.status_banner_auto')}
                </span>
              </div>

              {overrideStatus !== 'auto' && (
                <button
                  type="button"
                  onClick={() => handleSetOverride('auto')}
                  className="text-[11px] underline font-bold hover:text-slate-900 dark:hover:text-white cursor-pointer"
                >
                  {t('submission_control.btn_reset_auto')}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Analytics Summary Banner */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
            {t('grading.total_submissions')}
          </span>
          <p className="text-2xl font-black text-slate-900 dark:text-white mt-1">
            {submissions.filter((s) => s.status !== 'pending').length}
            <span className="text-xs font-normal text-slate-400 ml-1">/ {submissions.length}</span>
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
            {language === 'th' ? 'ตรวจแล้ว' : 'Graded'}
          </span>
          <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1">
            {gradedTotal}
            <span className="text-xs font-normal text-slate-400 ml-1">/ {submissions.length}</span>
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
            {t('grading.pending_eval')}
          </span>
          <p className="text-2xl font-black text-amber-600 dark:text-amber-400 mt-1">
            {submissions.length - gradedTotal}
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-rose-200 dark:border-rose-900/50 shadow-xs">
          <span className="text-xs text-rose-600 dark:text-rose-400 font-semibold flex items-center gap-1">
            <ShieldAlert className="w-3.5 h-3.5" />
            {t('grading.suspicious_count')}
          </span>
          <p className="text-2xl font-black text-rose-600 dark:text-rose-400 mt-1">
            {suspiciousTotal}
          </p>
        </div>
      </div>

      {/* Submissions Table & Filter Controls */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
        {/* Table Filters Bar */}
        <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4">
          {/* Search Box */}
          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={t('grading.search_student')}
              className="w-full pl-9 pr-4 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white focus:outline-hidden focus:border-amber-500 font-medium"
            />
          </div>

          {/* Filter Pills */}
          <div className="flex items-center gap-1.5 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
            <button
              onClick={() => setStatusFilter('all')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                statusFilter === 'all'
                  ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              {t('grading.filter_all')} ({submissions.length})
            </button>
            <button
              onClick={() => setStatusFilter('suspicious')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-1 cursor-pointer ${
                statusFilter === 'suspicious'
                  ? 'bg-rose-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40'
              }`}
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>{t('grading.filter_suspicious')} ({suspiciousTotal})</span>
            </button>
            <button
              onClick={() => setStatusFilter('pending')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                statusFilter === 'pending'
                  ? 'bg-amber-500 text-slate-950 font-bold'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
              }`}
            >
              {t('grading.filter_pending')} ({submissions.length - gradedTotal})
            </button>
            <button
              onClick={() => setStatusFilter('graded')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                statusFilter === 'graded'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
              }`}
            >
              {t('grading.filter_graded')} ({gradedTotal})
            </button>
          </div>
        </div>

        {/* Table Content */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-100 dark:border-slate-800">
              <tr>
                <th className="py-3.5 px-6">{t('grading.table.student_id')}</th>
                <th className="py-3.5 px-6">{t('grading.table.student_name')}</th>
                <th className="py-3.5 px-6">{t('grading.table.status')}</th>
                <th className="py-3.5 px-6">{t('grading.table.time_spent')}</th>
                <th className="py-3.5 px-6">{t('grading.table.integrity')}</th>
                <th className="py-3.5 px-6 text-center">{t('grading.table.score')}</th>
                <th className="py-3.5 px-6 text-right">{t('grading.table.action')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
              {filteredSubmissions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400">
                    {t('common.no_data')}
                  </td>
                </tr>
              ) : (
                filteredSubmissions.map((sub) => {
                  const student = sub.student;
                  const isGraded = sub.total_score !== undefined;

                  return (
                    <tr
                      key={sub.id}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="py-4 px-6 font-mono text-slate-500 dark:text-slate-400">
                        {student?.student_id || sub.student_id}
                      </td>

                      <td className="py-4 px-6">
                        <div className="flex items-center gap-3">
                          <img
                            src={
                              student?.avatar_url ||
                              'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100'
                            }
                            alt=""
                            className="w-7 h-7 rounded-full object-cover"
                          />
                          <span className="font-bold text-slate-900 dark:text-white">
                            {student?.first_name} {student?.last_name}
                          </span>
                        </div>
                      </td>

                      <td className="py-4 px-6">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                            sub.status === 'submitted'
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                              : sub.status === 'late'
                              ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                              : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                          }`}
                        >
                          {sub.status === 'submitted'
                            ? t('grading.status_badges.submitted')
                            : sub.status === 'late'
                            ? t('grading.status_badges.late')
                            : t('grading.status_badges.pending')}
                        </span>
                      </td>

                      <td className="py-4 px-6 text-slate-500 dark:text-slate-400 font-mono">
                        {Math.floor(sub.time_spent_seconds / 60)} {t('common.minutes')}
                      </td>

                      <td className="py-4 px-6">
                        <div className="flex items-center gap-2">
                          <AntiCheatingBadge
                            isFlagged={sub.is_flagged_suspicious}
                            tabSwitchCount={sub.tab_switch_count}
                            totalTimeAwaySeconds={sub.total_time_away_seconds}
                          />
                          {sub.is_flagged_suspicious && (
                            <button
                              type="button"
                              onClick={() => handleOpenAudit(sub)}
                              className="text-[11px] font-bold text-rose-600 dark:text-rose-400 hover:underline flex items-center gap-0.5 cursor-pointer"
                            >
                              <span>{t('grading.actions.view_audit')}</span>
                              <ExternalLink className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </td>

                      <td className="py-4 px-6 text-center font-bold">
                        {isGraded ? (
                          <span className="text-slate-900 dark:text-white font-mono text-sm">
                            {sub.total_score}
                            <span className="text-slate-400 font-normal text-xs ml-0.5">
                              / {sub.max_total_score || 20}
                            </span>
                          </span>
                        ) : (
                          <span className="text-amber-600 dark:text-amber-400 text-xs italic">
                            {t('grading.pending_eval')}
                          </span>
                        )}
                      </td>

                      <td className="py-4 px-6 text-right">
                        <button
                          type="button"
                          onClick={() => handleOpenGrading(sub)}
                          className="px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold transition-all shadow-xs flex items-center gap-1.5 ml-auto cursor-pointer"
                        >
                          <span>{t('grading.actions.grade_btn')}</span>
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Integrity Audit Modal */}
      {isAuditModalOpen && auditSubmission && (
        <IntegrityAuditModal
          isOpen={isAuditModalOpen}
          submission={auditSubmission}
          events={auditEvents}
          onClose={() => setIsAuditModalOpen(false)}
        />
      )}

      {/* Single-Page Continuous Grading Workspace Modal */}
      {isGradingWorkspaceOpen && gradingSubmission && (
        <GradingWorkspace
          submission={gradingSubmission}
          questions={questions}
          initialAnswers={gradingAnswers}
          onClose={() => {
            setIsGradingWorkspaceOpen(false);
            loadAllData();
          }}
          onNextStudent={handleNextStudent}
          onSaveGrade={async (subId, qId, score, comment, teacherId, teacherName, teacherRole) => {
            await dataService.saveTeacherGrade(
              subId,
              qId,
              score,
              comment,
              teacherId,
              teacherName,
              teacherRole as TeacherRole
            );
            const refreshed = await dataService.getSubmissions(assignmentId);
            setSubmissions(refreshed);
          }}
        />
      )}
    </div>
  );
}
