'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  ClassroomTeacher,
  Question,
  Submission,
  SubmissionAnswer,
  TeacherGradeRecord,
  TeacherRole,
} from '@/types/database';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import {
  Sparkles,
  CheckCircle2,
  FileText,
  Image as ImageIcon,
  ZoomIn,
  ZoomOut,
  RotateCw,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Save,
  Check,
  UploadCloud,
  Loader2,
  BookOpen,
  Award,
  AlertCircle,
  Users,
  ShieldCheck,
  Settings2,
  Plus,
  Trash2,
  MessageSquare,
  X,
  Compass,
} from 'lucide-react';

interface GradingWorkspaceProps {
  submission: Submission;
  questions: Question[];
  initialAnswers: Record<string, SubmissionAnswer>;
  onClose: () => void;
  onNextStudent?: () => void;
  onSaveGrade: (
    submissionId: string,
    questionId: string,
    score: number,
    comment: string,
    teacherId: string,
    teacherName: string,
    teacherRole: TeacherRole
  ) => Promise<void>;
}

interface QuestionGradeState {
  score: number | string;
  comment: string;
  isSaving: boolean;
  saveSuccess: boolean;
}

const DEFAULT_PRESET_TEMPLATES = [
  { id: 'p1', category: 'praise', text: 'ดีเยี่ยม เข้าใจประเด็นชัดเจนและครอบคลุมนิยาม' },
  { id: 'p2', category: 'reasoning', text: 'ลำดับเหตุผลและวิธีทำถูกต้องสมบูรณ์ เป็นระเบียบเรียบร้อย' },
  { id: 'p3', category: 'missing', text: 'ขาดการแสดงขั้นตอนวิธีคิดอย่างละเอียด ควรแจกแจงกรณีเพิ่มเติม' },
  { id: 'p4', category: 'missing', text: 'ควรยกตัวอย่างประพจน์ประกอบอย่างน้อย 1 รูปแบบตามโจทย์' },
  { id: 'p5', category: 'improvement', text: 'ควรปรับปรุงลายมือและจัดระเบียบตารางค่าความจริงให้อ่านง่ายขึ้น' },
  { id: 'p6', category: 'integrity', text: 'ตรวจพบข้อความวางจากภายนอก ควรเรียบเรียงและสรุปด้วยความเข้าใจของตนเอง' },
];

export const GradingWorkspace: React.FC<GradingWorkspaceProps> = ({
  submission,
  questions,
  initialAnswers,
  onClose,
  onNextStudent,
  onSaveGrade,
}) => {
  const { t, language } = useLanguage();

  // Co-Teacher / Research Grader Switcher
  const availableTeachers: ClassroomTeacher[] = [
    {
      teacher_id: 'teacher-tippanan',
      name: 'ครูธิปนรรจ์ พรายหนู (Primary)',
      email: 'tippanan.p@pudding.ac.th',
      avatar_url: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=100',
      role: 'primary',
    },
    {
      teacher_id: 'teacher-somchai',
      name: 'ครูสมชาย วิทยากร (Co-Teacher / IRR)',
      email: 'somchai.w@pudding.ac.th',
      avatar_url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100',
      role: 'assistant',
    },
  ];

  const [activeTeacher, setActiveTeacher] = useState<ClassroomTeacher>(availableTeachers[0]);

  // Master local answers state
  const [answers, setAnswers] = useState<Record<string, SubmissionAnswer>>(initialAnswers);

  // Per-question in-line grade & feedback state
  const [questionGrades, setQuestionGrades] = useState<Record<string, QuestionGradeState>>(() => {
    const initial: Record<string, QuestionGradeState> = {};
    for (const q of questions) {
      const ans = initialAnswers[q.id];
      initial[q.id] = {
        score: ans?.teacher_score ?? ans?.ai_mock_score ?? '',
        comment: ans?.teacher_comment ?? '',
        isSaving: false,
        saveSuccess: false,
      };
    }
    return initial;
  });

  // Image zoom/rotation controls per question
  const [imageControls, setImageControls] = useState<Record<string, { zoom: number; rotate: number }>>({});

  // Custom Suggestion Templates
  const [suggestionPresets, setSuggestionPresets] = useState(DEFAULT_PRESET_TEMPLATES);
  const [isPresetModalOpen, setIsPresetModalOpen] = useState(false);
  const [newPresetText, setNewPresetText] = useState('');
  const [focusedQuestionId, setFocusedQuestionId] = useState<string | null>(null);

  // Global saving state
  const [isSavingAll, setIsSavingAll] = useState(false);

  // Active Grader switch handler
  const handleTeacherSwitch = (teacher: ClassroomTeacher) => {
    setActiveTeacher(teacher);
    setQuestionGrades(() => {
      const updated: Record<string, QuestionGradeState> = {};
      for (const q of questions) {
        const ans = answers[q.id];
        if (teacher.role === 'primary') {
          updated[q.id] = {
            score: ans?.teacher_score ?? ans?.ai_mock_score ?? '',
            comment: ans?.teacher_comment ?? '',
            isSaving: false,
            saveSuccess: false,
          };
        } else {
          const coGrade = ans?.co_grades?.[teacher.teacher_id];
          updated[q.id] = {
            score: coGrade?.score ?? ans?.ai_mock_score ?? '',
            comment: coGrade?.comment ?? '',
            isSaving: false,
            saveSuccess: false,
          };
        }
      }
      return updated;
    });
  };

  // Score change
  const handleScoreChange = (qId: string, value: number | string) => {
    setQuestionGrades((prev) => ({
      ...prev,
      [qId]: { ...prev[qId], score: value },
    }));
  };

  // Comment change
  const handleCommentChange = (qId: string, value: string) => {
    setQuestionGrades((prev) => ({
      ...prev,
      [qId]: { ...prev[qId], comment: value },
    }));
  };

  // Accept AI Score & Feedback for single question
  const handleAcceptAIScore = (qId: string) => {
    const ans = answers[qId];
    if (ans?.ai_mock_score !== undefined) {
      setQuestionGrades((prev) => ({
        ...prev,
        [qId]: {
          ...prev[qId],
          score: ans.ai_mock_score!,
          comment: prev[qId]?.comment ? prev[qId].comment : ans.ai_feedback || '',
        },
      }));
    }
  };

  // Insert suggestion chip into textarea
  const handleInsertSuggestion = (qId: string, chipText: string) => {
    const current = questionGrades[qId]?.comment || '';
    const updated = current ? `${current} ${chipText}` : chipText;
    handleCommentChange(qId, updated);
  };

  // Context-Aware Autocomplete Ranking
  const getContextualSuggestions = (currentText: string) => {
    const textLower = currentText.toLowerCase().trim();
    if (!textLower) return suggestionPresets;

    return [...suggestionPresets].sort((a, b) => {
      let aScore = 0;
      let bScore = 0;

      // Positive keywords
      if (textLower.includes('ดี') || textLower.includes('ยอด') || textLower.includes('เก่ง') || textLower.includes('ชัด')) {
        if (a.category === 'praise') aScore += 5;
        if (b.category === 'praise') bScore += 5;
      }
      // Missing requirements
      if (textLower.includes('ขาด') || textLower.includes('ตก') || textLower.includes('หล่น') || textLower.includes('ยัง')) {
        if (a.category === 'missing') aScore += 5;
        if (b.category === 'missing') bScore += 5;
      }
      // Improvement & handwriting
      if (textLower.includes('ปรับ') || textLower.includes('ควร') || textLower.includes('ลายมือ') || textLower.includes('เขียน')) {
        if (a.category === 'improvement') aScore += 5;
        if (b.category === 'improvement') bScore += 5;
      }
      // Integrity & external paste
      if (textLower.includes('วาง') || textLower.includes('ลอก') || textLower.includes('ก๊อป') || textLower.includes('ทุจริต') || textLower.includes('ai')) {
        if (a.category === 'integrity') aScore += 5;
        if (b.category === 'integrity') bScore += 5;
      }

      return bScore - aScore;
    });
  };

  // Image controls per question
  const getControls = (qId: string) => imageControls[qId] || { zoom: 1, rotate: 0 };
  const updateControls = (qId: string, zoom: number, rotate: number) => {
    setImageControls((prev) => ({
      ...prev,
      [qId]: { zoom, rotate },
    }));
  };

  // Save single question grade
  const handleSaveQuestion = async (q: Question) => {
    const gradeState = questionGrades[q.id];
    if (!gradeState) return;

    const numScore = Number(gradeState.score);
    if (isNaN(numScore) || numScore < 0 || numScore > q.max_score) {
      alert(
        language === 'th'
          ? `ข้อที่ ${q.question_text.slice(0, 20)}: กรุณากรอกคะแนนระหว่าง 0 ถึง ${q.max_score}`
          : `Please enter a score between 0 and ${q.max_score}`
      );
      return;
    }

    setQuestionGrades((prev) => ({
      ...prev,
      [q.id]: { ...prev[q.id], isSaving: true },
    }));

    try {
      await onSaveGrade(
        submission.id,
        q.id,
        numScore,
        gradeState.comment,
        activeTeacher.teacher_id,
        activeTeacher.name,
        activeTeacher.role
      );

      // update local answers cache
      const isPrimary = activeTeacher.role === 'primary';
      const existing = answers[q.id] || {
        id: `ans-${Date.now()}`,
        submission_id: submission.id,
        question_id: q.id,
      };

      const newCoGrades = { ...(existing.co_grades || {}) };
      newCoGrades[activeTeacher.teacher_id] = {
        teacher_id: activeTeacher.teacher_id,
        teacher_name: activeTeacher.name,
        teacher_role: activeTeacher.role,
        score: numScore,
        comment: gradeState.comment,
        graded_at: new Date().toISOString(),
      };

      setAnswers((prev) => ({
        ...prev,
        [q.id]: {
          ...existing,
          teacher_score: isPrimary ? numScore : existing.teacher_score,
          teacher_comment: isPrimary ? gradeState.comment : existing.teacher_comment,
          co_grades: newCoGrades,
        },
      }));

      setQuestionGrades((prev) => ({
        ...prev,
        [q.id]: { ...prev[q.id], isSaving: false, saveSuccess: true },
      }));

      setTimeout(() => {
        setQuestionGrades((prev) => ({
          ...prev,
          [q.id]: { ...prev[q.id], saveSuccess: false },
        }));
      }, 2500);
    } catch (err) {
      console.error(err);
      alert('Error saving grade');
      setQuestionGrades((prev) => ({
        ...prev,
        [q.id]: { ...prev[q.id], isSaving: false },
      }));
    }
  };

  // Save all questions and proceed to next student
  const handleSaveAllAndNext = async () => {
    setIsSavingAll(true);
    try {
      for (const q of questions) {
        const gradeState = questionGrades[q.id];
        const numScore = Number(gradeState?.score ?? 0);
        if (!isNaN(numScore)) {
          await onSaveGrade(
            submission.id,
            q.id,
            numScore,
            gradeState?.comment || '',
            activeTeacher.teacher_id,
            activeTeacher.name,
            activeTeacher.role
          );
        }
      }

      if (onNextStudent) {
        onNextStudent();
      } else {
        onClose();
      }
    } catch (err) {
      console.error(err);
      alert('Error saving all grades');
    } finally {
      setIsSavingAll(false);
    }
  };

  // Inter-Rater Reliability (IRR) statistics summary
  const irrSummary = useMemo(() => {
    let pairCount = 0;
    let totalDelta = 0;

    for (const q of questions) {
      const ans = answers[q.id];
      const primaryGrade = ans?.teacher_score;
      const coGrade = ans?.co_grades?.['teacher-somchai']?.score;

      if (primaryGrade !== undefined && coGrade !== undefined) {
        pairCount += 1;
        totalDelta += Math.abs(primaryGrade - coGrade);
      }
    }

    const avgDelta = pairCount > 0 ? totalDelta / pairCount : 0;
    return {
      pairCount,
      avgDelta: Math.round(avgDelta * 10) / 10,
      isHighAgreement: avgDelta <= 0.5,
    };
  }, [questions, answers]);

  const scrollToQuestion = (idx: number) => {
    const el = document.getElementById(`question-card-${idx}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-100/90 dark:bg-slate-950/95 backdrop-blur-md overflow-hidden animate-in fade-in transition-colors">
      {/* Top Floating App Bar */}
      <header className="h-16 px-6 border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md flex items-center justify-between shrink-0 shadow-xs">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex items-center gap-1.5 text-xs font-bold cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
            <span>{t('common.close')}</span>
          </button>

          <div className="h-5 w-px bg-slate-200 dark:border-slate-800 hidden sm:block" />

          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-black text-slate-900 dark:text-white">
                {t('grading.workspace.title')}
              </h2>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950 text-amber-900 dark:text-amber-300 font-bold border border-amber-200 dark:border-amber-900">
                {submission.student?.first_name} {submission.student?.last_name}
              </span>
              <span className="text-xs text-slate-400 font-mono hidden sm:inline">
                ID: {submission.student?.student_id || submission.student_id}
              </span>
            </div>
          </div>
        </div>

        {/* Center: Co-Teaching / Grader Persona Selector */}
        <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-2xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
          <span className="text-xs font-bold text-slate-500 dark:text-slate-400 flex items-center gap-1">
            <Users className="w-3.5 h-3.5 text-amber-500" />
            <span>{t('grading.workspace.active_grader')}:</span>
          </span>
          <div className="flex items-center gap-1">
            {availableTeachers.map((tchr) => {
              const isSelected = activeTeacher.teacher_id === tchr.teacher_id;
              return (
                <button
                  key={tchr.teacher_id}
                  type="button"
                  onClick={() => handleTeacherSwitch(tchr)}
                  className={`px-3 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                    isSelected
                      ? 'bg-amber-500 text-slate-950 shadow-xs'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-white/60 dark:hover:bg-slate-700'
                  }`}
                >
                  <img
                    src={tchr.avatar_url}
                    alt=""
                    className="w-4 h-4 rounded-full object-cover"
                  />
                  <span>{tchr.role === 'primary' ? 'ครูธิปนรรจ์ (Primary)' : 'ครูสมชาย (Assistant/IRR)'}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right Action Buttons */}
        <div className="flex items-center gap-3">
          {onNextStudent && (
            <button
              type="button"
              disabled={isSavingAll}
              onClick={handleSaveAllAndNext}
              className="px-4 py-2 rounded-2xl bg-slate-950 dark:bg-white text-white dark:text-slate-950 hover:bg-slate-900 dark:hover:bg-slate-100 text-xs font-bold flex items-center gap-1.5 transition-all shadow-md cursor-pointer disabled:opacity-50"
            >
              {isSavingAll ? <Loader2 className="w-4 h-4 animate-spin text-amber-400" /> : <Save className="w-4 h-4 text-amber-400" />}
              <span>{t('grading.workspace.save_all_and_next')}</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </header>

      {/* Student Publication Notice Banner */}
      <div className="px-6 py-2 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-900/50 flex items-center justify-between text-xs text-amber-900 dark:text-amber-200">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
          <span>
            {activeTeacher.role === 'primary'
              ? '📢 ' + t('grading.workspace.primary_badge')
              : '🔬 ' + t('grading.workspace.assistant_badge')}
          </span>
        </div>

        {irrSummary.pairCount > 0 && (
          <div className="hidden sm:flex items-center gap-2 font-mono text-[11px] font-bold">
            <span>{t('grading.workspace.irr_panel_title')}:</span>
            <span className="px-2 py-0.5 rounded bg-amber-200/60 dark:bg-amber-900/60 text-amber-950 dark:text-amber-200">
              Δ {irrSummary.avgDelta} คะแนน ({irrSummary.isHighAgreement ? t('grading.workspace.irr_agreement_high') : t('grading.workspace.irr_agreement_moderate')})
            </span>
          </div>
        )}
      </div>

      {/* Main Single-Page Workspace: Vertical Continuous Scroll View */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sticky Mini-Map / Jump Navigation */}
        <aside className="w-48 shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 p-4 hidden md:flex flex-col justify-between overflow-y-auto">
          <div className="space-y-3">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
              {language === 'th' ? 'สารบัญคำถาม (Mini-Map)' : 'Question Jump'}
            </span>
            <div className="space-y-1.5">
              {questions.map((q, idx) => {
                const ans = answers[q.id];
                const isGraded = ans?.teacher_score !== undefined;
                return (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => scrollToQuestion(idx)}
                    className="w-full px-3 py-2 rounded-xl text-xs font-semibold flex items-center justify-between text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-left cursor-pointer"
                  >
                    <span className="truncate">ข้อที่ {idx + 1}</span>
                    {isGraded ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                    ) : (
                      <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Quick Integrity Pill */}
          {submission.is_flagged_suspicious && (
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900/50 text-rose-700 dark:text-rose-300 text-[11px] space-y-1">
              <span className="font-bold block flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" />
                <span>แจ้งเตือนพฤติกรรม</span>
              </span>
              <p>สลับแท็บ {submission.tab_switch_count} ครั้ง ({submission.total_time_away_seconds}s)</p>
            </div>
          )}
        </aside>

        {/* Center: VERTICAL CONTINUOUS SCROLL VIEW */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-8 space-y-8 bg-slate-50 dark:bg-slate-950">
          <div className="max-w-4xl mx-auto space-y-8">
            {questions.map((q, idx) => {
              const ans = answers[q.id];
              const gradeState = questionGrades[q.id] || {
                score: '',
                comment: '',
                isSaving: false,
                saveSuccess: false,
              };
              const controls = getControls(q.id);
              const contextualChips = getContextualSuggestions(gradeState.comment);

              return (
                <div
                  key={q.id}
                  id={`question-card-${idx}`}
                  className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm p-6 space-y-6 transition-all scroll-mt-6"
                >
                  {/* Question Header & Standard Tag */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-3">
                      <span className="w-9 h-9 rounded-2xl bg-amber-500 text-slate-950 font-black text-sm flex items-center justify-center shadow-xs">
                        {idx + 1}
                      </span>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-slate-900 dark:text-white">
                            {t('grading.workspace.question_nav')} {idx + 1}
                          </span>
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 uppercase">
                            {q.type}
                          </span>
                          {q.indicator?.code && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 font-mono">
                              {q.indicator.code}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          {q.rubric_criteria || '-'}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold px-3 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono">
                        {t('common.points')}: {q.max_score}
                      </span>
                    </div>
                  </div>

                  {/* Question Text Prompt */}
                  <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700/60 text-xs font-medium text-slate-800 dark:text-slate-200 leading-relaxed">
                    {q.question_text}
                  </div>

                  {/* Student Response Display (Text or File Attachment) */}
                  <div className="space-y-3">
                    <span className="text-xs font-bold text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
                      <FileText className="w-4 h-4 text-emerald-600" />
                      <span>{t('grading.workspace.student_answer_tab')}</span>
                    </span>

                    {/* If File Upload Submission */}
                    {ans?.file_url ? (
                      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-950 overflow-hidden space-y-3 p-4">
                        <div className="flex items-center justify-between text-xs pb-2 border-b border-slate-200 dark:border-slate-800">
                          <span className="font-semibold text-slate-500 dark:text-slate-400">
                            {t('grading.workspace.student_file_tab')}
                          </span>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                updateControls(q.id, Math.max(0.6, controls.zoom - 0.2), controls.rotate)
                              }
                              className="p-1.5 rounded-lg bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200"
                              title="Zoom Out"
                            >
                              <ZoomOut className="w-3.5 h-3.5" />
                            </button>
                            <span className="font-mono text-[11px] text-slate-400">
                              {Math.round(controls.zoom * 100)}%
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                updateControls(q.id, Math.min(2.0, controls.zoom + 0.2), controls.rotate)
                              }
                              className="p-1.5 rounded-lg bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200"
                              title="Zoom In"
                            >
                              <ZoomIn className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                updateControls(q.id, controls.zoom, (controls.rotate + 90) % 360)
                              }
                              className="p-1.5 rounded-lg bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200"
                              title="Rotate"
                            >
                              <RotateCw className="w-3.5 h-3.5" />
                            </button>
                            <a
                              href={ans.file_url}
                              target="_blank"
                              rel="noreferrer"
                              className="p-1.5 rounded-lg bg-white dark:bg-slate-800 text-amber-600 dark:text-amber-400 hover:bg-slate-200"
                              title="Open original"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          </div>
                        </div>

                        <div className="flex items-center justify-center p-2 overflow-auto max-h-[500px]">
                          <div
                            className="transition-transform duration-200 rounded-xl overflow-hidden shadow-md"
                            style={{
                              transform: `scale(${controls.zoom}) rotate(${controls.rotate}deg)`,
                            }}
                          >
                            <img
                              src={ans.file_url}
                              alt="Submission"
                              className="max-h-[450px] object-contain select-none"
                            />
                          </div>
                        </div>
                      </div>
                    ) : ans?.text_answer ? (
                      /* Text response */
                      <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 text-xs font-mono leading-relaxed text-slate-900 dark:text-slate-100 whitespace-pre-wrap select-all">
                        {ans.text_answer}
                      </div>
                    ) : (
                      /* Empty */
                      <div className="p-4 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 text-center text-xs text-slate-400">
                        {t('grading.workspace.no_file_uploaded')}
                      </div>
                    )}
                  </div>

                  {/* ASAG AI Mockup Evaluation Card */}
                  {ans?.ai_mock_score !== undefined && (
                    <div className="p-4 rounded-2xl bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-950/40 dark:to-purple-950/30 border border-indigo-200 dark:border-indigo-900/50 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Sparkles className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                          <span className="text-xs font-bold text-indigo-900 dark:text-indigo-200">
                            {t('grading.workspace.ai_section_title')}
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-black text-indigo-700 dark:text-indigo-300 font-mono">
                            {ans.ai_mock_score} / {q.max_score} {t('common.points')}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleAcceptAIScore(q.id)}
                            className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold transition-all shadow-xs flex items-center gap-1 cursor-pointer"
                          >
                            <Check className="w-3 h-3" />
                            <span>{t('grading.workspace.accept_ai_score')}</span>
                          </button>
                        </div>
                      </div>
                      <p className="text-xs text-indigo-900/80 dark:text-indigo-200/80 leading-relaxed">
                        {ans.ai_feedback}
                      </p>
                    </div>
                  )}

                  {/* Co-Teaching Independent Grades Comparison (IRR Data) */}
                  {ans?.co_grades && Object.keys(ans.co_grades).length > 1 && (
                    <div className="p-3.5 rounded-2xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-900/40 space-y-2">
                      <span className="text-xs font-bold text-amber-900 dark:text-amber-200 flex items-center gap-1.5">
                        <Award className="w-3.5 h-3.5 text-amber-600" />
                        <span>การประเมินของผู้ร่วมตรวจ (Research Multi-Grading):</span>
                      </span>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                        {Object.values(ans.co_grades).map((record) => (
                          <div
                            key={record.teacher_id}
                            className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-amber-200/50 dark:border-slate-800 flex items-center justify-between"
                          >
                            <div>
                              <span className="font-bold text-slate-800 dark:text-slate-200 block">
                                {record.teacher_name}
                              </span>
                              <span className="text-[10px] text-slate-400">
                                {record.teacher_role === 'primary' ? 'Primary Owner' : 'Assistant / IRR'}
                              </span>
                            </div>
                            <span className="font-mono font-black text-sm text-slate-900 dark:text-white">
                              {record.score} / {q.max_score}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* IN-LINE SCORE INPUT & TEACHER FEEDBACK COMPONENT */}
                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                          {t('grading.workspace.teacher_score_label')}:
                        </span>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            step="0.5"
                            min="0"
                            max={q.max_score}
                            value={gradeState.score}
                            onChange={(e) => handleScoreChange(q.id, e.target.value)}
                            className="w-20 px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white font-mono font-black text-base text-center focus:outline-hidden focus:border-amber-500"
                            placeholder="0.0"
                          />
                          <span className="text-xs text-slate-400 font-mono">
                            / {q.max_score}
                          </span>
                        </div>
                      </div>

                      {/* Quick Score Preset Pills */}
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleScoreChange(q.id, q.max_score)}
                          className="px-2.5 py-1 rounded-lg bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 font-mono text-xs font-bold hover:bg-emerald-200 transition-colors"
                        >
                          เต็ม ({q.max_score})
                        </button>
                        <button
                          type="button"
                          onClick={() => handleScoreChange(q.id, Math.max(0, q.max_score - 1))}
                          className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono text-xs font-bold hover:bg-slate-200"
                        >
                          {Math.max(0, q.max_score - 1)}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleScoreChange(q.id, 0)}
                          className="px-2.5 py-1 rounded-lg bg-rose-100 dark:bg-rose-950/70 text-rose-800 dark:text-rose-300 font-mono text-xs font-bold hover:bg-rose-200"
                        >
                          0
                        </button>
                      </div>
                    </div>

                    {/* SMART ADAPTIVE SUGGESTION BAR (iOS KEYBOARD STYLE) */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                        <span className="font-bold flex items-center gap-1">
                          <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                          <span>{t('grading.suggestions.title')}</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => setIsPresetModalOpen(true)}
                          className="hover:underline flex items-center gap-1 text-amber-600 dark:text-amber-400 font-semibold cursor-pointer"
                        >
                          <Settings2 className="w-3 h-3" />
                          <span>{t('grading.suggestions.manage_templates')}</span>
                        </button>
                      </div>

                      {/* Horizontal Scrolling Chips Bar */}
                      <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
                        {contextualChips.map((preset) => (
                          <button
                            key={preset.id}
                            type="button"
                            onClick={() => handleInsertSuggestion(q.id, preset.text)}
                            className="px-3 py-1.5 rounded-full bg-slate-100 dark:bg-slate-800 hover:bg-amber-100 dark:hover:bg-amber-950 hover:text-amber-900 dark:hover:text-amber-200 text-slate-700 dark:text-slate-300 text-xs font-semibold whitespace-nowrap transition-all border border-slate-200 dark:border-slate-700 cursor-pointer shadow-xs active:scale-95 shrink-0"
                          >
                            + {preset.text}
                          </button>
                        ))}
                      </div>

                      {/* Teacher Feedback Textarea */}
                      <textarea
                        rows={2}
                        value={gradeState.comment}
                        onFocus={() => setFocusedQuestionId(q.id)}
                        onChange={(e) => handleCommentChange(q.id, e.target.value)}
                        placeholder={t('grading.workspace.teacher_comment_placeholder')}
                        className="w-full px-3.5 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white focus:outline-hidden focus:border-amber-500 leading-relaxed"
                      />
                    </div>

                    {/* Question Action Save Button */}
                    <div className="flex items-center justify-between pt-1">
                      {gradeState.saveSuccess ? (
                        <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5 animate-in fade-in">
                          <CheckCircle2 className="w-4 h-4" />
                          <span>{t('grading.workspace.saved_success')}</span>
                        </span>
                      ) : (
                        <div />
                      )}

                      <button
                        type="button"
                        disabled={gradeState.isSaving}
                        onClick={() => handleSaveQuestion(q)}
                        className="px-4 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-xs transition-transform active:scale-95 disabled:opacity-50"
                      >
                        {gradeState.isSaving ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Save className="w-3.5 h-3.5" />
                        )}
                        <span>{t('grading.workspace.save_grade')}</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </main>
      </div>

      {/* MANAGE CUSTOM FEEDBACK PRESET TEMPLATES MODAL */}
      {isPresetModalOpen && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in"
          onClick={() => setIsPresetModalOpen(false)}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-3xl max-w-md w-full border border-slate-200 dark:border-slate-800 shadow-2xl p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-500" />
                <span>{t('grading.suggestions.manage_templates')}</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsPresetModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Existing Presets List */}
            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {suggestionPresets.map((preset) => (
                <div
                  key={preset.id}
                  className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-2 text-xs"
                >
                  <span className="text-slate-800 dark:text-slate-200 font-medium truncate">
                    {preset.text}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setSuggestionPresets(suggestionPresets.filter((p) => p.id !== preset.id))
                    }
                    className="p-1 text-slate-400 hover:text-rose-500 rounded shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            {/* Add New Preset */}
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2">
              <input
                type="text"
                value={newPresetText}
                onChange={(e) => setNewPresetText(e.target.value)}
                placeholder="พิมพ์ข้อความแม่แบบใหม่ เช่น ตอบตรงประเด็นดีมาก..."
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white"
              />
              <button
                type="button"
                onClick={() => {
                  if (newPresetText.trim()) {
                    setSuggestionPresets([
                      ...suggestionPresets,
                      { id: `preset-${Date.now()}`, category: 'custom', text: newPresetText.trim() },
                    ]);
                    setNewPresetText('');
                  }
                }}
                className="w-full py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs shadow-xs"
              >
                {t('grading.suggestions.add_new_chip')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
