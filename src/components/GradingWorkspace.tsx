'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ClassroomTeacher, Question, Submission, SubmissionAnswer, TeacherRole } from '@/types/database';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { Avatar } from '@/components/Avatar';
import {
  AlertCircle,
  Award,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  FlaskConical,
  Loader2,
  Minus,
  Plus,
  RotateCw,
  Save,
  Settings2,
  Sparkles,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

interface GradingWorkspaceProps {
  submission: Submission;
  questions: Question[];
  initialAnswers: Record<string, SubmissionAnswer>;
  /** The signed-in teacher and their role in this classroom. */
  grader: ClassroomTeacher;
  /** Position of this student in the grading order, e.g. 3 of 25. */
  studentPosition?: { index: number; total: number };
  /** Quizzes track leaving the screen; homework does not, so no integrity alert. */
  tracksAway?: boolean;
  onClose: () => void;
  onPrevStudent?: () => void;
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

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface QuestionGradeState {
  score: string;
  comment: string;
  /** Last saved values, to know what changed. */
  savedScore: string;
  savedComment: string;
  status: SaveStatus;
}

type Preset = { id: string; category: string; text: string };

/** Subject-neutral starter comments; teachers add their own in "จัดการ". */
const DEFAULT_PRESETS: Preset[] = [
  { id: 'p1', category: 'praise', text: 'ดีมาก ตอบครบถ้วนและตรงประเด็น' },
  { id: 'p2', category: 'reasoning', text: 'แสดงวิธีคิดและเหตุผลได้ชัดเจน' },
  { id: 'p3', category: 'missing', text: 'ควรอธิบายขั้นตอนหรือเหตุผลเพิ่มเติม' },
  { id: 'p4', category: 'missing', text: 'ควรยกตัวอย่างประกอบให้ชัดเจนขึ้น' },
  { id: 'p5', category: 'improvement', text: 'ควรตรวจทานความถูกต้องอีกครั้งก่อนส่ง' },
  { id: 'p6', category: 'integrity', text: 'ควรเรียบเรียงคำตอบด้วยความเข้าใจและสำนวนของตนเอง' },
];

const isPdf = (url: string) => /\.pdf($|\?)/i.test(url);
const roundHalf = (n: number) => Math.round(n * 2) / 2;

export const GradingWorkspace: React.FC<GradingWorkspaceProps> = ({
  submission,
  questions,
  initialAnswers,
  grader,
  studentPosition,
  tracksAway = true,
  onClose,
  onPrevStudent,
  onNextStudent,
  onSaveGrade,
}) => {
  const { t, language } = useLanguage();
  const th = language === 'th';
  const isResearcher = grader.role === 'researcher';

  const [answers, setAnswers] = useState<Record<string, SubmissionAnswer>>(initialAnswers);

  // Prefill with what this grader saved before, so editing starts from it.
  const [grades, setGrades] = useState<Record<string, QuestionGradeState>>(() => {
    const states: Record<string, QuestionGradeState> = {};
    for (const q of questions) {
      const ans = initialAnswers[q.id];
      const own = ans?.co_grades?.[grader.teacher_id];
      const saved = isResearcher
        ? ans?.research_grades?.[grader.teacher_id] ?? own
        : { score: ans?.teacher_score ?? own?.score, comment: ans?.teacher_comment ?? own?.comment };
      const score = saved?.score != null ? String(saved.score) : '';
      const comment = saved?.comment ?? '';
      states[q.id] = { score, comment, savedScore: score, savedComment: comment, status: 'idle' };
    }
    return states;
  });

  const [imageControls, setImageControls] = useState<Record<string, { zoom: number; rotate: number }>>({});
  const [isSavingAll, setIsSavingAll] = useState(false);

  // Feedback chips: per teacher, remembered in this browser.
  const presetsKey = `pudding_feedback_presets_${grader.teacher_id}`;
  const [presets, setPresets] = useState<Preset[]>(() => {
    try {
      const stored = typeof window !== 'undefined' ? localStorage.getItem(presetsKey) : null;
      return stored ? (JSON.parse(stored) as Preset[]) : DEFAULT_PRESETS;
    } catch {
      return DEFAULT_PRESETS;
    }
  });
  const updatePresets = (next: Preset[]) => {
    setPresets(next);
    try {
      localStorage.setItem(presetsKey, JSON.stringify(next));
    } catch {}
  };
  const [isPresetModalOpen, setIsPresetModalOpen] = useState(false);
  const [newPresetText, setNewPresetText] = useState('');

  const isDirty = (g?: QuestionGradeState) => !!g && (g.score !== g.savedScore || g.comment !== g.savedComment);
  const dirtyQuestions = questions.filter((q) => isDirty(grades[q.id]));
  const gradedCount = questions.filter((q) => grades[q.id]?.savedScore !== '').length;
  const maxTotal = questions.reduce((sum, q) => sum + Number(q.max_score || 0), 0);
  const runningTotal = roundHalf(questions.reduce((sum, q) => sum + (Number(grades[q.id]?.score) || 0), 0));

  const setGrade = (qId: string, patch: Partial<QuestionGradeState>) =>
    setGrades((prev) => ({ ...prev, [qId]: { ...prev[qId], ...patch, status: patch.status ?? 'idle' } }));

  const stepScore = (q: Question, delta: number) => {
    const current = Number(grades[q.id]?.score) || 0;
    setGrade(q.id, { score: String(Math.min(q.max_score, Math.max(0, roundHalf(current + delta)))) });
  };

  const insertPreset = (qId: string, text: string) => {
    const current = grades[qId]?.comment || '';
    setGrade(qId, { comment: current ? `${current} ${text}` : text });
  };

  // Rank chips by words already typed (praise, missing work, improvement, integrity).
  const rankedPresets = (text: string) => {
    const lower = text.toLowerCase();
    if (!lower.trim()) return presets;
    const hints: Record<string, string[]> = {
      praise: ['ดี', 'ยอด', 'เก่ง', 'ชัด'],
      missing: ['ขาด', 'ตก', 'หล่น', 'ยัง'],
      improvement: ['ปรับ', 'ควร', 'ลายมือ', 'เขียน'],
      integrity: ['วาง', 'ลอก', 'ก๊อป', 'ทุจริต', 'ai'],
    };
    const weight = (p: Preset) => (hints[p.category]?.some((w) => lower.includes(w)) ? 1 : 0);
    return [...presets].sort((a, b) => weight(b) - weight(a));
  };

  /** Save one question; returns false when the score is invalid or saving failed. */
  const saveQuestion = async (q: Question): Promise<boolean> => {
    const g = grades[q.id];
    if (!g || !isDirty(g)) return true;
    if (g.score.trim() === '') {
      alert(th ? `ข้อที่ ${questions.indexOf(q) + 1}: กรุณาใส่คะแนนก่อนบันทึก` : `Question ${questions.indexOf(q) + 1}: enter a score first`);
      return false;
    }
    const score = Number(g.score);
    if (Number.isNaN(score) || score < 0 || score > q.max_score) {
      alert(th ? `ข้อที่ ${questions.indexOf(q) + 1}: คะแนนต้องอยู่ระหว่าง 0 ถึง ${q.max_score}` : `Question ${questions.indexOf(q) + 1}: score must be 0–${q.max_score}`);
      return false;
    }

    setGrade(q.id, { status: 'saving' });
    try {
      await onSaveGrade(submission.id, q.id, score, g.comment, grader.teacher_id, grader.name, grader.role);
      const record = {
        teacher_id: grader.teacher_id,
        teacher_name: grader.name,
        teacher_role: grader.role,
        score,
        comment: g.comment,
        graded_at: new Date().toISOString(),
      };
      setAnswers((prev) => {
        const existing = prev[q.id] || ({ id: `ans-${submission.id}-${q.id}`, submission_id: submission.id, question_id: q.id } as SubmissionAnswer);
        return {
          ...prev,
          [q.id]: {
            ...existing,
            teacher_score: isResearcher ? existing.teacher_score : score,
            teacher_comment: isResearcher ? existing.teacher_comment : g.comment,
            co_grades: { ...(existing.co_grades || {}), [grader.teacher_id]: record },
            research_grades: isResearcher ? { ...(existing.research_grades || {}), [grader.teacher_id]: record } : existing.research_grades,
          },
        };
      });
      setGrades((prev) => ({
        ...prev,
        [q.id]: { ...prev[q.id], score: String(score), savedScore: String(score), savedComment: g.comment, status: 'saved' },
      }));
      return true;
    } catch (err) {
      console.error(err);
      setGrade(q.id, { status: 'error' });
      alert(err instanceof Error ? `${th ? 'บันทึกคะแนนไม่สำเร็จ' : 'Could not save'}: ${err.message}` : th ? 'บันทึกคะแนนไม่สำเร็จ' : 'Could not save');
      return false;
    }
  };

  /** Save every changed question in order; stops at the first problem. */
  const saveAll = async (): Promise<boolean> => {
    setIsSavingAll(true);
    try {
      for (const q of dirtyQuestions) {
        if (!(await saveQuestion(q))) {
          document.getElementById(`question-card-${q.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return false;
        }
      }
      return true;
    } finally {
      setIsSavingAll(false);
    }
  };

  const confirmLeave = () =>
    dirtyQuestions.length === 0 ||
    confirm(th ? `มี ${dirtyQuestions.length} ข้อที่ยังไม่บันทึก ต้องการออกโดยไม่บันทึกหรือไม่?` : `${dirtyQuestions.length} unsaved question(s). Leave without saving?`);

  const handleClose = () => confirmLeave() && onClose();
  const handlePrev = () => onPrevStudent && confirmLeave() && onPrevStudent();
  const handleSaveAndNext = async () => {
    if (!(await saveAll())) return;
    if (onNextStudent) onNextStudent();
    else onClose();
  };

  // Ctrl/⌘+S saves, Ctrl/⌘+Enter saves and moves on, Esc closes.
  const shortcuts = useRef({ saveAll, handleSaveAndNext, handleClose });
  useEffect(() => {
    shortcuts.current = { saveAll, handleSaveAndNext, handleClose };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        shortcuts.current.saveAll();
      } else if (mod && e.key === 'Enter') {
        e.preventDefault();
        shortcuts.current.handleSaveAndNext();
      } else if (e.key === 'Escape' && !isPresetModalOpen) {
        shortcuts.current.handleClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isPresetModalOpen]);

  // Agreement between this grader and the other graders, for research.
  const agreement = useMemo(() => {
    let pairs = 0;
    let delta = 0;
    for (const q of questions) {
      const records = Object.values(answers[q.id]?.co_grades || {});
      const mine = records.find((r) => r.teacher_id === grader.teacher_id);
      for (const other of records) {
        if (!mine || other.teacher_id === grader.teacher_id) continue;
        pairs += 1;
        delta += Math.abs(mine.score - other.score);
      }
    }
    const avg = pairs ? Math.round((delta / pairs) * 10) / 10 : 0;
    return { pairs, avg, high: avg <= 0.5 };
  }, [answers, questions, grader.teacher_id]);

  const roleLabel = (role: TeacherRole) =>
    role === 'primary' ? (th ? 'ครูประจำวิชา' : 'Teacher') : role === 'assistant' ? 'TA' : th ? 'ผู้ตรวจวิจัย' : 'Researcher';
  const typeLabel = (type: Question['type']) =>
    ({
      multiple_choice: th ? 'ปรนัย' : 'Multiple choice',
      true_false: th ? 'ถูก/ผิด' : 'True/false',
      short_answer: th ? 'เขียนตอบสั้น' : 'Short answer',
      essay: th ? 'เรียงความ' : 'Essay',
      file_upload: th ? 'อัปโหลดไฟล์' : 'File upload',
    } as Record<string, string>)[type] || type;

  const studentName = `${submission.student?.first_name || ''} ${submission.student?.last_name || ''}`.trim() || (th ? 'นักเรียน' : 'Student');
  const isLast = !onNextStudent;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-100 dark:bg-slate-950 animate-in fade-in">
      {/* ── Header: who is being graded, progress, and who is grading ── */}
      <header className="pt-[env(safe-area-inset-top)] bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 shrink-0">
        <div className="min-h-16 px-3 sm:px-6 flex items-center gap-3">
          <button
            type="button"
            onClick={handleClose}
            title={th ? 'ปิด (Esc)' : 'Close (Esc)'}
            className="p-2 rounded-xl text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <Avatar
              src={submission.student?.avatar_url}
              firstName={submission.student?.first_name}
              lastName={submission.student?.last_name}
              className="w-9 h-9 text-xs"
            />
            <div className="min-w-0">
              <p className="text-sm font-black text-slate-900 dark:text-white truncate">{studentName}</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                {submission.student?.student_id ? `${th ? 'รหัส' : 'ID'} ${submission.student.student_id}` : ''}
                {studentPosition ? `${submission.student?.student_id ? ' · ' : ''}${th ? 'คนที่' : 'Student'} ${studentPosition.index + 1}/${studentPosition.total}` : ''}
              </p>
            </div>
          </div>

          {/* Progress */}
          <div className="hidden md:flex flex-col items-end gap-1 shrink-0 w-44">
            <div className="flex items-baseline gap-2 text-xs">
              <span className="text-slate-500 dark:text-slate-400">{th ? 'ตรวจแล้ว' : 'Graded'} {gradedCount}/{questions.length}</span>
              <span className="font-black text-slate-900 dark:text-white tabular-nums">
                {runningTotal}/{maxTotal}
              </span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all"
                style={{ width: `${questions.length ? (gradedCount / questions.length) * 100 : 0}%` }}
              />
            </div>
          </div>

          {/* Grader */}
          <div className="hidden sm:flex items-center gap-2 pl-3 ml-1 border-l border-slate-200 dark:border-slate-800 shrink-0">
            <Avatar src={grader.avatar_url} name={grader.name} className="w-8 h-8 text-[10px]" />
            <div className="leading-tight">
              <p className="text-xs font-bold text-slate-900 dark:text-white max-w-36 truncate">{grader.name}</p>
              <p className={`text-[10px] font-bold ${isResearcher ? 'text-purple-600 dark:text-purple-400' : 'text-amber-600 dark:text-amber-400'}`}>
                {roleLabel(grader.role)}
              </p>
            </div>
          </div>
        </div>

        {isResearcher && (
          <div className="px-3 sm:px-6 py-2 bg-purple-50 dark:bg-purple-950/40 border-t border-purple-200 dark:border-purple-900/50 text-xs text-purple-900 dark:text-purple-200 flex items-center gap-2">
            <FlaskConical className="w-4 h-4 shrink-0" />
            <span>
              {th
                ? 'โหมดตรวจเพื่อการวิจัย: คะแนนของคุณเก็บแยกไว้ ไม่แสดงต่อนักเรียน และไม่เปลี่ยนคะแนนจริงของวิชา'
                : 'Research mode: your scores are stored separately and never shown to students or change official grades.'}
            </span>
          </div>
        )}
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* ── Question list ── */}
        <aside className="w-52 shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 hidden md:flex flex-col gap-3 overflow-y-auto">
          <span className="px-1 text-[11px] font-bold text-slate-400 uppercase tracking-wider">{th ? 'ข้อสอบ' : 'Questions'}</span>
          <nav className="space-y-1">
            {questions.map((q, idx) => {
              const g = grades[q.id];
              const dirty = isDirty(g);
              const saved = g?.savedScore !== '';
              return (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => document.getElementById(`question-card-${q.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  className="w-full px-3 py-2 rounded-xl text-xs font-semibold flex items-center justify-between gap-2 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${dirty ? 'bg-amber-500' : saved ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`}
                    />
                    {th ? 'ข้อ' : 'Q'} {idx + 1}
                  </span>
                  <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                    {g?.score !== '' ? g?.score : '–'}/{q.max_score}
                  </span>
                </button>
              );
            })}
          </nav>
          <div className="mt-auto space-y-2 text-[11px]">
            <p className="px-1 text-slate-400 flex flex-wrap gap-x-3 gap-y-1">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" />{th ? 'บันทึกแล้ว' : 'Saved'}</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" />{th ? 'ยังไม่บันทึก' : 'Unsaved'}</span>
            </p>
            {agreement.pairs > 0 && (
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                <span className="font-bold block">{th ? 'เทียบกับผู้ตรวจอื่น' : 'vs. other graders'}</span>
                <span>Δ {agreement.avg} · {agreement.high ? t('grading.workspace.irr_agreement_high') : t('grading.workspace.irr_agreement_moderate')}</span>
              </div>
            )}
            {tracksAway && submission.is_flagged_suspicious && (
              <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900/50 text-rose-700 dark:text-rose-300 space-y-0.5">
                <span className="font-bold flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" />
                  {th ? 'พฤติกรรมน่าสงสัย' : 'Integrity alert'}
                </span>
                <p>{th ? `สลับแท็บ ${submission.tab_switch_count} ครั้ง (${submission.total_time_away_seconds} วินาที)` : `${submission.tab_switch_count} tab switches (${submission.total_time_away_seconds}s)`}</p>
              </div>
            )}
          </div>
        </aside>

        {/* ── Questions ── */}
        <main className="flex-1 overflow-y-auto p-3 sm:p-6">
          <div className="max-w-3xl mx-auto space-y-5 pb-6">
            {questions.map((q, idx) => {
              const ans = answers[q.id];
              const g = grades[q.id];
              const dirty = isDirty(g);
              const controls = imageControls[q.id] || { zoom: 1, rotate: 0 };
              const setControls = (zoom: number, rotate: number) => setImageControls((prev) => ({ ...prev, [q.id]: { zoom, rotate } }));
              const otherGrades = Object.values(ans?.co_grades || {}).filter((r) => r.teacher_id !== grader.teacher_id);
              const isObjective = q.type === 'multiple_choice' || q.type === 'true_false';

              return (
                <section
                  key={q.id}
                  id={`question-card-${q.id}`}
                  className={`bg-white dark:bg-slate-900 rounded-3xl border shadow-xs p-4 sm:p-6 space-y-4 scroll-mt-4 transition-colors ${
                    dirty ? 'border-amber-300 dark:border-amber-800' : 'border-slate-200 dark:border-slate-800'
                  }`}
                >
                  {/* Question header */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-8 h-8 rounded-xl bg-amber-500 text-slate-950 font-black text-sm flex items-center justify-center shrink-0">
                        {idx + 1}
                      </span>
                      <div className="min-w-0 flex flex-wrap items-center gap-1.5">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                          {typeLabel(q.type)}
                        </span>
                        {q.indicator?.code && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 font-mono">
                            {q.indicator.code}
                          </span>
                        )}
                        <span className="text-[11px] text-slate-400">{th ? `เต็ม ${q.max_score} คะแนน` : `${q.max_score} pts`}</span>
                      </div>
                    </div>
                    <span className="shrink-0 text-[11px] font-bold">
                      {g?.status === 'saving' ? (
                        <span className="text-slate-400 flex items-center gap-1"><Loader2 className="w-3.5 h-3.5 animate-spin" />{th ? 'กำลังบันทึก' : 'Saving'}</span>
                      ) : dirty ? (
                        <span className="text-amber-600 dark:text-amber-400">{th ? 'ยังไม่บันทึก' : 'Unsaved'}</span>
                      ) : g?.savedScore !== '' ? (
                        <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" />{th ? 'บันทึกแล้ว' : 'Saved'}</span>
                      ) : null}
                    </span>
                  </div>

                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100 leading-relaxed whitespace-pre-wrap">{q.question_text}</p>
                  {q.rubric_criteria && (
                    <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                      <span className="font-bold">{th ? 'เกณฑ์: ' : 'Rubric: '}</span>
                      {q.rubric_criteria}
                    </p>
                  )}

                  {/* Student answer */}
                  <div className="space-y-2">
                    <span className="text-xs font-bold text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
                      <FileText className="w-4 h-4 text-emerald-600" />
                      {t('grading.workspace.student_answer_tab')}
                    </span>

                    {ans?.file_url ? (
                      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 overflow-hidden">
                        <div className="flex items-center justify-end gap-1.5 px-3 py-2 border-b border-slate-200 dark:border-slate-800">
                          {!isPdf(ans.file_url) && (
                            <>
                              <button type="button" onClick={() => setControls(Math.max(0.6, controls.zoom - 0.2), controls.rotate)} className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-pointer" title={th ? 'ย่อ' : 'Zoom out'}>
                                <ZoomOut className="w-4 h-4" />
                              </button>
                              <span className="font-mono text-[11px] text-slate-400 w-10 text-center">{Math.round(controls.zoom * 100)}%</span>
                              <button type="button" onClick={() => setControls(Math.min(2, controls.zoom + 0.2), controls.rotate)} className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-pointer" title={th ? 'ขยาย' : 'Zoom in'}>
                                <ZoomIn className="w-4 h-4" />
                              </button>
                              <button type="button" onClick={() => setControls(controls.zoom, (controls.rotate + 90) % 360)} className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-pointer" title={th ? 'หมุน' : 'Rotate'}>
                                <RotateCw className="w-4 h-4" />
                              </button>
                            </>
                          )}
                          <a href={ans.file_url} target="_blank" rel="noreferrer" className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-amber-600 dark:text-amber-400" title={t('grading.workspace.open_original_file')}>
                            <ExternalLink className="w-4 h-4" />
                          </a>
                        </div>
                        {isPdf(ans.file_url) ? (
                          <iframe src={ans.file_url} title={`answer-${idx + 1}`} className="w-full h-[480px] bg-white" />
                        ) : (
                          <div className="flex items-center justify-center p-3 overflow-auto max-h-[480px]">
                            <img
                              src={ans.file_url}
                              alt=""
                              className="max-h-[440px] object-contain select-none rounded-lg transition-transform duration-200"
                              style={{ transform: `scale(${controls.zoom}) rotate(${controls.rotate}deg)` }}
                            />
                          </div>
                        )}
                      </div>
                    ) : ans?.text_answer ? (
                      <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-sm leading-relaxed text-slate-900 dark:text-slate-100 whitespace-pre-wrap">
                        {ans.text_answer}
                      </div>
                    ) : (
                      <div className="p-4 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 text-center text-xs text-slate-400">
                        {th ? 'นักเรียนไม่ได้ตอบข้อนี้' : 'No answer for this question'}
                      </div>
                    )}
                    {isObjective && q.ideal_answer && (
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        <span className="font-bold">{th ? 'เฉลย: ' : 'Answer key: '}</span>
                        {q.ideal_answer}
                      </p>
                    )}
                  </div>

                  {/* Other graders */}
                  {otherGrades.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {otherGrades.map((r) => (
                        <span key={r.teacher_id} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-[11px] text-slate-600 dark:text-slate-300">
                          <Award className="w-3 h-3 text-amber-500" />
                          {r.teacher_name} ({roleLabel(r.teacher_role)}):
                          <b className="font-mono text-slate-900 dark:text-white">{r.score}/{q.max_score}</b>
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Grading panel */}
                  <div className={`p-3 sm:p-4 rounded-2xl space-y-3 ${isResearcher ? 'bg-purple-50/70 dark:bg-purple-950/30' : 'bg-amber-50/60 dark:bg-amber-950/20'}`}>
                    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                      <span className="text-xs font-bold text-slate-700 dark:text-slate-300 w-full sm:w-auto">
                        {isResearcher ? (th ? 'คะแนนวิจัย' : 'Research score') : t('grading.workspace.teacher_score_label')}
                      </span>
                      <div className="flex items-center rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 overflow-hidden">
                        <button type="button" onClick={() => stepScore(q, -0.5)} className="px-2.5 py-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer" aria-label="-0.5">
                          <Minus className="w-4 h-4" />
                        </button>
                        <input
                          type="number"
                          inputMode="decimal"
                          step="0.5"
                          min="0"
                          max={q.max_score}
                          value={g?.score ?? ''}
                          onChange={(e) => setGrade(q.id, { score: e.target.value })}
                          placeholder="–"
                          className="w-16 py-1.5 bg-transparent text-center font-mono font-black text-lg text-slate-900 dark:text-white focus:outline-hidden [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                        />
                        <button type="button" onClick={() => stepScore(q, 0.5)} className="px-2.5 py-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer" aria-label="+0.5">
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>
                      <span className="text-sm text-slate-400 font-mono">/ {q.max_score}</span>
                      <div className="flex items-center gap-1.5 sm:ml-auto">
                        {[
                          { label: '0', value: 0, cls: 'bg-rose-100 dark:bg-rose-950/70 text-rose-800 dark:text-rose-300' },
                          { label: th ? 'ครึ่ง' : 'Half', value: roundHalf(q.max_score / 2), cls: 'bg-slate-200/70 dark:bg-slate-800 text-slate-700 dark:text-slate-300' },
                          { label: th ? 'เต็ม' : 'Full', value: q.max_score, cls: 'bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300' },
                        ].map((chip) => (
                          <button
                            key={chip.label}
                            type="button"
                            onClick={() => setGrade(q.id, { score: String(chip.value) })}
                            className={`px-2.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer hover:opacity-80 ${chip.cls}`}
                          >
                            {chip.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <textarea
                      rows={2}
                      value={g?.comment ?? ''}
                      onChange={(e) => setGrade(q.id, { comment: e.target.value })}
                      placeholder={th ? 'คำแนะนำถึงนักเรียน (ไม่บังคับ)' : 'Feedback for the student (optional)'}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white focus:outline-hidden focus:border-amber-500 leading-relaxed"
                    />

                    <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none -mx-1 px-1">
                      <Sparkles className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      {rankedPresets(g?.comment || '').map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => insertPreset(q.id, preset.text)}
                          className="px-2.5 py-1 rounded-full bg-white dark:bg-slate-800 hover:bg-amber-100 dark:hover:bg-amber-950 text-slate-700 dark:text-slate-300 text-[11px] font-semibold whitespace-nowrap border border-slate-200 dark:border-slate-700 cursor-pointer shrink-0"
                        >
                          + {preset.text}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => setIsPresetModalOpen(true)}
                        title={t('grading.suggestions.manage_templates')}
                        className="p-1.5 rounded-full text-slate-400 hover:text-amber-600 hover:bg-white dark:hover:bg-slate-800 cursor-pointer shrink-0"
                      >
                        <Settings2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {dirty && (
                      <div className="flex justify-end">
                        <button
                          type="button"
                          disabled={g?.status === 'saving' || isSavingAll}
                          onClick={() => saveQuestion(q)}
                          className="px-3.5 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-amber-400 text-amber-700 dark:text-amber-300 font-bold text-xs flex items-center gap-1.5 cursor-pointer hover:bg-amber-50 dark:hover:bg-amber-950/40 disabled:opacity-50"
                        >
                          {g?.status === 'saving' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                          {th ? 'บันทึกข้อนี้' : 'Save this question'}
                        </button>
                      </div>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </main>
      </div>

      {/* ── Action bar: always in the same place ── */}
      <footer className="shrink-0 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 px-3 sm:px-6 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] flex items-center gap-2 sm:gap-3">
        {onPrevStudent ? (
          <button
            type="button"
            onClick={handlePrev}
            disabled={isSavingAll}
            className="px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold flex items-center gap-1 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
          >
            <ChevronLeft className="w-4 h-4" />
            <span className="hidden sm:inline">{th ? 'คนก่อนหน้า' : 'Previous'}</span>
          </button>
        ) : (
          <span />
        )}

        <span className={`flex-1 text-xs font-semibold truncate ${dirtyQuestions.length ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400'}`}>
          {dirtyQuestions.length
            ? th ? `ยังไม่บันทึก ${dirtyQuestions.length} ข้อ` : `${dirtyQuestions.length} unsaved`
            : gradedCount === questions.length
            ? th ? 'บันทึกครบทุกข้อแล้ว' : 'All questions saved'
            : th ? `ตรวจแล้ว ${gradedCount}/${questions.length} ข้อ` : `${gradedCount}/${questions.length} graded`}
          <span className="hidden lg:inline text-slate-400 font-normal"> · Ctrl+S {th ? 'บันทึก' : 'save'} · Ctrl+Enter {th ? 'บันทึกแล้วไปต่อ' : 'save & next'}</span>
        </span>

        <button
          type="button"
          onClick={saveAll}
          disabled={isSavingAll || dirtyQuestions.length === 0}
          className="px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold flex items-center gap-1.5 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isSavingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          <span className="hidden sm:inline">{th ? 'บันทึก' : 'Save'}</span>
        </button>
        <button
          type="button"
          onClick={handleSaveAndNext}
          disabled={isSavingAll}
          className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-black flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-50"
        >
          {isLast ? <Check className="w-4 h-4" /> : null}
          <span>
            {isLast
              ? th ? 'บันทึกแล้วปิด' : 'Save & close'
              : th ? 'บันทึกแล้วไปคนถัดไป' : 'Save & next'}
          </span>
          {!isLast && <ChevronRight className="w-4 h-4" />}
        </button>
      </footer>

      {/* Manage feedback chips */}
      {isPresetModalOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs" onClick={() => setIsPresetModalOpen(false)}>
          <div
            className="bg-white dark:bg-slate-900 rounded-3xl max-w-md w-full border border-slate-200 dark:border-slate-800 shadow-2xl p-5 sm:p-6 space-y-4 max-h-[calc(100dvh-2rem)] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-500" />
                {t('grading.suggestions.manage_templates')}
              </h3>
              <button type="button" onClick={() => setIsPresetModalOpen(false)} className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {presets.map((preset) => (
                <div key={preset.id} className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-2 text-xs">
                  <span className="text-slate-800 dark:text-slate-200 font-medium">{preset.text}</span>
                  <button type="button" onClick={() => updatePresets(presets.filter((p) => p.id !== preset.id))} className="p-1 text-slate-400 hover:text-rose-500 rounded shrink-0 cursor-pointer">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            <form
              className="pt-2 border-t border-slate-100 dark:border-slate-800 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!newPresetText.trim()) return;
                updatePresets([...presets, { id: `preset-${Date.now()}`, category: 'custom', text: newPresetText.trim() }]);
                setNewPresetText('');
              }}
            >
              <input
                type="text"
                value={newPresetText}
                onChange={(e) => setNewPresetText(e.target.value)}
                placeholder={th ? 'ข้อความใหม่ เช่น ตอบตรงประเด็นดีมาก' : 'New comment'}
                className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white"
              />
              <button type="submit" className="px-3 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs cursor-pointer shrink-0">
                {th ? 'เพิ่ม' : 'Add'}
              </button>
            </form>
            <button type="button" onClick={() => updatePresets(DEFAULT_PRESETS)} className="text-[11px] text-slate-400 hover:text-slate-600 underline cursor-pointer">
              {th ? 'คืนค่าเริ่มต้น' : 'Reset to defaults'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
