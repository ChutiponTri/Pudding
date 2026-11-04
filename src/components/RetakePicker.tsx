'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import { ArrowLeft, Check, ChevronRight, Copy, FilePlus2, Loader2, RotateCcw, Search, ShieldAlert } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { dataService } from '@/lib/supabase/dataService';
import { cachedCall } from '@/lib/cache/sessionCache';
import { ModalSheet, ModalSheetBody, ModalSheetFooter, ModalSheetHeader } from '@/components/ModalSheet';
import { getAssignmentStatus, getAssignmentWindow, isAssignmentPublished, ASSIGNMENT_STATUS_CLASSES } from '@/lib/utils/assignmentWindow';
import { isGraded, isHandedIn, isIntegrityFlagged, isStudentSubmission } from '@/lib/utils/gradingStatus';
import { isRetake } from '@/lib/utils/retake';
import { formatDateTime } from '@/lib/utils/datetime';
import type { Assignment, Classroom, Submission, User } from '@/types/database';

type Step = 'quiz' | 'students' | 'version';
type Version = 'new' | 'same';
type Row = { student: User; sub: Submission | null; flagged: boolean };

const fullName = (s: Partial<User>) => `${s.first_name || ''} ${s.last_name || ''}`.trim() || s.name || '-';

/**
 * "Retake quiz": pick the quiz, the students who retake it (flagged ones
 * first), then a new version (default) or the same questions. Opens the
 * creation page set up for a retake: only those students see it, and their
 * retake score replaces their score of the original quiz.
 */
export function RetakePicker({
  classroomId,
  sourceId,
  from,
  onNavigate,
  onClose,
}: {
  /** Quizzes of this classroom only; none = every classroom of the teacher. */
  classroomId?: string;
  /** Start at the students of this quiz (e.g. from its grading page). */
  sourceId?: string;
  from?: 'classroom' | 'dashboard';
  /** Called before leaving the page (e.g. the mobile sidebar closes itself). */
  onNavigate?: () => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const { user } = useUser();
  const teacherId = user?.id;
  const { tr, language } = useLanguage();

  const [step, setStep] = useState<Step>(sourceId ? 'students' : 'quiz');
  const [quizzes, setQuizzes] = useState<Array<Assignment & { classroomLabel?: string }> | null>(null);
  const [quizSearch, setQuizSearch] = useState('');
  const [source, setSource] = useState<{ id: string; assignment?: Assignment; classroom?: Classroom; subs?: Submission[] } | null>(
    sourceId ? { id: sourceId } : null
  );
  const [studentSearch, setStudentSearch] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [version, setVersion] = useState<Version>('new');
  const [error, setError] = useState('');

  // Step 1: quizzes students already took (published, not a retake themselves).
  useEffect(() => {
    if (step !== 'quiz' || quizzes || !teacherId) return;
    let cancelled = false;
    (async () => {
      const classrooms = classroomId
        ? null
        : await cachedCall('reuseClassroomList', teacherId, () => dataService.getClassroomList());
      const ids = classroomId ? [classroomId] : (classrooms || []).map((c) => c.id);
      const list = await dataService.getAssignmentsByClassroomIds(ids);
      const nameOf = new Map((classrooms || []).map((c) => [c.id, c.name]));
      return list
        .filter((a) => a.is_exam && !isRetake(a) && isAssignmentPublished(a))
        .sort((a, b) => (b.due_date || '').localeCompare(a.due_date || ''))
        .map((a) => ({ ...a, classroomLabel: classroomId ? undefined : nameOf.get(a.classroom_id) || a.classroom_name }));
    })()
      .then((list) => !cancelled && setQuizzes(list))
      .catch((err) => !cancelled && (setQuizzes([]), setError(err instanceof Error ? err.message : String(err))));
    return () => {
      cancelled = true;
    };
  }, [step, quizzes, teacherId, classroomId]);

  // Step 2: the quiz's roster and how each student did.
  const sourceKey = source?.id;
  const sourceLoaded = !!source?.classroom;
  useEffect(() => {
    if (!sourceKey || sourceLoaded) return;
    let cancelled = false;
    Promise.all([
      dataService.getAssignmentById(sourceKey, { withClassroom: true }),
      dataService.getSubmissionsByAssignmentIds([sourceKey], { includeStudents: false }),
    ])
      .then(([{ assignment, classroom }, subs]) => {
        if (cancelled) return;
        if (!assignment || !classroom) {
          setError(tr('ไม่พบข้อสอบนี้', 'Quiz not found'));
          return;
        }
        if (!assignment.is_exam || isRetake(assignment)) {
          setError(tr('สอบซ่อมได้จากข้อสอบปกติเท่านั้น', 'Retakes start from a regular quiz'));
          return;
        }
        setSource({ id: sourceKey, assignment, classroom, subs });
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [sourceKey, sourceLoaded, tr]);

  const rows: Row[] = useMemo(() => {
    if (!source?.classroom) return [];
    const subs = source.subs || [];
    return (source.classroom.students || [])
      .map((student) => {
        const sub = subs.find((s) => isStudentSubmission(s, student)) || null;
        return { student, sub, flagged: !!sub && isIntegrityFlagged(sub, true) };
      })
      .sort(
        (a, b) =>
          Number(b.flagged) - Number(a.flagged) ||
          (a.student.student_id || '').localeCompare(b.student.student_id || '', undefined, { numeric: true }) ||
          fullName(a.student).localeCompare(fullName(b.student))
      );
  }, [source]);
  const flaggedIds = rows.filter((r) => r.flagged).map((r) => r.student.id);
  const visibleRows = useMemo(() => {
    const q = studentSearch.trim().toLowerCase();
    return q ? rows.filter((r) => `${fullName(r.student)} ${r.student.student_id || ''}`.toLowerCase().includes(q)) : rows;
  }, [rows, studentSearch]);
  const visibleQuizzes = useMemo(() => {
    const q = quizSearch.trim().toLowerCase();
    return (quizzes || []).filter((a) => !q || `${a.title} ${a.classroomLabel || ''}`.toLowerCase().includes(q));
  }, [quizzes, quizSearch]);

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const go = () => {
    const a = source?.assignment;
    if (!a || !picked.size) return;
    const params = new URLSearchParams({ classroomId: a.classroom_id, mode: 'quiz', retakeOf: a.id, retakeStudents: [...picked].join(',') });
    if (from) params.set('from', from);
    if (version === 'same') {
      params.set('copy', a.id);
      params.set('reuse', '1');
    }
    onClose();
    onNavigate?.();
    router.push(`/assignments/new?${params}`);
  };

  const back = () => {
    setError('');
    if (step === 'version') setStep('students');
    else if (step === 'students' && !sourceId) {
      setStep('quiz');
      setSource(null);
      setPicked(new Set());
    }
  };
  const canGoBack = step === 'version' || (step === 'students' && !sourceId);
  const stepNo = step === 'quiz' ? 1 : step === 'students' ? 2 : 3;
  const heading =
    step === 'quiz' ? tr('เลือกข้อสอบเดิม', 'Pick the quiz') : step === 'students' ? tr('เลือกนักเรียนที่ต้องสอบซ่อม', 'Pick students') : tr('ข้อสอบซ่อม', 'Retake version');

  // On <body>: a menu inside a sticky / blurred header would otherwise clip it to that header.
  return createPortal(
    <ModalSheet onClose={onClose} size="sm:max-w-xl" zIndex="z-95" labelledBy="retake-title">
      <ModalSheetHeader>
        <div className="flex items-center gap-3 min-w-0">
          {canGoBack ? (
            <button
              type="button"
              onClick={back}
              aria-label={tr('ย้อนกลับ', 'Back')}
              className="w-10 h-10 shrink-0 rounded-2xl ring-1 ring-slate-200 dark:ring-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              <ArrowLeft className="w-4.5 h-4.5" />
            </button>
          ) : (
            <span className="w-10 h-10 shrink-0 rounded-2xl bg-orange-500 text-white flex items-center justify-center shadow-md shadow-orange-500/30">
              <RotateCcw className="w-5 h-5" />
            </span>
          )}
          <div className="min-w-0">
            <p className="text-[11px] font-bold text-orange-600 dark:text-orange-400">
              {tr(`สอบซ่อม · ขั้นที่ ${stepNo}/3`, `Retake · step ${stepNo}/3`)}
            </p>
            <h2 id="retake-title" className="text-sm sm:text-base font-black text-slate-900 dark:text-white truncate">
              {heading}
            </h2>
          </div>
        </div>
      </ModalSheetHeader>

      <ModalSheetBody className="space-y-3">
        {error && <p className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 text-xs font-semibold">{error}</p>}

        {step === 'quiz' && (
          <>
            <SearchBox value={quizSearch} onChange={setQuizSearch} placeholder={tr('ค้นหาข้อสอบ', 'Search quizzes')} />
            {!quizzes ? (
              <Loading />
            ) : visibleQuizzes.length === 0 ? (
              <p className="py-10 text-center text-xs text-slate-500">{tr('ยังไม่มีข้อสอบที่เผยแพร่แล้ว', 'No published quizzes yet')}</p>
            ) : (
              <ul className="space-y-2">
                {visibleQuizzes.map((a) => {
                  const status = getAssignmentStatus(getAssignmentWindow(a), true, language);
                  return (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setError('');
                          setSource({ id: a.id });
                          setPicked(new Set());
                          setStep('students');
                        }}
                        className="w-full p-3 rounded-2xl ring-1 ring-slate-200 dark:ring-slate-800 hover:ring-orange-300 dark:hover:ring-orange-800 hover:bg-orange-50/50 dark:hover:bg-orange-950/20 flex items-center gap-3 text-left cursor-pointer transition-colors"
                      >
                        <span className="w-9 h-9 shrink-0 rounded-xl bg-purple-50 dark:bg-purple-950/50 text-purple-600 dark:text-purple-400 flex items-center justify-center">
                          <ShieldAlert className="w-4 h-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-bold text-slate-900 dark:text-white truncate">{a.title}</span>
                          <span className="block text-[11px] text-slate-500 dark:text-slate-400 truncate">
                            {[a.classroomLabel, formatDateTime(a.due_date, language)].filter(Boolean).join(' · ')}
                          </span>
                        </span>
                        <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold ${ASSIGNMENT_STATUS_CLASSES[status.tone]}`}>{status.label}</span>
                        <ChevronRight className="w-4 h-4 shrink-0 text-slate-300 dark:text-slate-600" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}

        {step === 'students' && (
          <>
            {source?.assignment && (
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                {tr('จากข้อสอบ', 'From')} <b className="text-slate-800 dark:text-slate-100">{source.assignment.title}</b>
              </p>
            )}
            {!source?.classroom ? (
              !error && <Loading />
            ) : (
              <>
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="flex-1">
                    <SearchBox value={studentSearch} onChange={setStudentSearch} placeholder={tr('ค้นหาชื่อหรือรหัส', 'Search name or ID')} />
                  </div>
                  {flaggedIds.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setPicked((prev) => new Set([...prev, ...flaggedIds]))}
                      className="h-10 px-3 rounded-xl text-xs font-bold bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 ring-1 ring-rose-200 dark:ring-rose-900 hover:bg-rose-100 cursor-pointer whitespace-nowrap"
                    >
                      {tr(`เลือกคนที่น่าสงสัย (${flaggedIds.length})`, `Pick flagged (${flaggedIds.length})`)}
                    </button>
                  )}
                </div>
                {rows.length === 0 ? (
                  <p className="py-10 text-center text-xs text-slate-500">{tr('ห้องนี้ยังไม่มีนักเรียน', 'No students in this class')}</p>
                ) : (
                  <ul className="space-y-1.5">
                    {visibleRows.map(({ student, sub, flagged }) => {
                      const on = picked.has(student.id);
                      return (
                        <li key={student.id}>
                          <button
                            type="button"
                            role="checkbox"
                            aria-checked={on}
                            onClick={() => toggle(student.id)}
                            className={`w-full p-2.5 rounded-2xl flex items-center gap-3 text-left cursor-pointer ring-1 transition-colors ${
                              on
                                ? 'bg-orange-50 dark:bg-orange-950/30 ring-orange-300 dark:ring-orange-800'
                                : 'ring-slate-200 dark:ring-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                            }`}
                          >
                            <span
                              className={`w-5 h-5 shrink-0 rounded-md flex items-center justify-center ${
                                on ? 'bg-orange-500 text-white' : 'ring-2 ring-slate-300 dark:ring-slate-600'
                              }`}
                            >
                              {on && <Check className="w-3.5 h-3.5" strokeWidth={3} />}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-bold text-slate-900 dark:text-white truncate">{fullName(student)}</span>
                              <span className="block text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                {[
                                  student.student_id && `${tr('รหัส', 'ID')} ${student.student_id}`,
                                  !sub || !isHandedIn(sub)
                                    ? tr('ไม่ได้ส่ง', 'Not handed in')
                                    : isGraded(sub)
                                    ? `${sub.total_score}/${sub.max_total_score || source.assignment?.total_points || 20}`
                                    : tr('รอตรวจ', 'To grade'),
                                ]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </span>
                            </span>
                            {flagged && (
                              <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300">
                                <ShieldAlert className="w-3 h-3" />
                                {tr(`ออกจอ ${sub?.tab_switch_count || 0}`, `Left ${sub?.tab_switch_count || 0}×`)}
                              </span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            )}
          </>
        )}

        {step === 'version' && (
          <div role="radiogroup" aria-label={tr('ข้อสอบซ่อม', 'Retake version')} className="space-y-2">
            {([
              {
                id: 'new' as const,
                icon: FilePlus2,
                title: tr('สร้างข้อสอบชุดใหม่', 'Write a new version'),
                hint: tr('แนะนำ · คำถามใหม่ที่ยังไม่มีใครเห็น', 'Recommended · questions nobody has seen'),
              },
              {
                id: 'same' as const,
                icon: Copy,
                title: tr('ใช้ข้อสอบชุดเดิม', 'Use the same questions'),
                hint: tr('คัดลอกคำถามเดิม แก้ไขได้ก่อนบันทึก', 'Copies the questions; edit before saving'),
              },
            ]).map((option) => {
              const on = version === option.id;
              const Icon = option.icon;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setVersion(option.id)}
                  className={`w-full p-3.5 rounded-2xl flex items-center gap-3 text-left cursor-pointer ring-2 transition-colors ${
                    on ? 'bg-orange-50 dark:bg-orange-950/30 ring-orange-400 dark:ring-orange-700' : 'ring-slate-200 dark:ring-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                  }`}
                >
                  <span
                    className={`w-10 h-10 shrink-0 rounded-xl flex items-center justify-center ${
                      on ? 'bg-orange-500 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-black text-slate-900 dark:text-white">{option.title}</span>
                    <span className="block text-[11px] text-slate-500 dark:text-slate-400">{option.hint}</span>
                  </span>
                  <span className={`w-5 h-5 shrink-0 rounded-full ${on ? 'ring-[6px] ring-orange-500' : 'ring-2 ring-slate-300 dark:ring-slate-600'}`} />
                </button>
              );
            })}
            <ul className="pt-2 space-y-1 text-[11px] text-slate-500 dark:text-slate-400">
              <li>• {tr(`เห็นและทำได้เฉพาะ ${picked.size} คนที่เลือก`, `Only the ${picked.size} chosen students can see and take it`)}</li>
              <li>• {tr('คะแนนสอบซ่อมแทนคะแนนเดิมในข้อสอบเดิม', 'The retake score replaces their original score')}</li>
              <li>• {tr('ส่งลิงก์เข้ากลุ่ม LINE ของห้อง ไม่มีแจ้งเตือนซ้ำ', 'Link goes to the class LINE group, no reminders')}</li>
            </ul>
          </div>
        )}
      </ModalSheetBody>

      {step !== 'quiz' && (
        <ModalSheetFooter>
          <span className="mr-auto text-xs font-bold text-slate-600 dark:text-slate-300">
            {tr(`เลือกแล้ว ${picked.size} คน`, `${picked.size} selected`)}
          </span>
          {step === 'students' ? (
            <button
              type="button"
              disabled={!picked.size}
              onClick={() => setStep('version')}
              className="h-11 px-5 rounded-2xl text-sm font-black bg-orange-500 hover:bg-orange-600 text-white shadow-lg shadow-orange-500/30 inline-flex items-center gap-1.5 cursor-pointer active:scale-[0.98] transition-transform disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {tr('ต่อไป', 'Next')}
              <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={go}
              className="h-11 px-5 rounded-2xl text-sm font-black bg-orange-500 hover:bg-orange-600 text-white shadow-lg shadow-orange-500/30 inline-flex items-center gap-1.5 cursor-pointer active:scale-[0.98] transition-transform"
            >
              {version === 'new' ? tr('ไปเขียนข้อสอบ', 'Write the quiz') : tr('ไปตรวจข้อสอบ', 'Review the quiz')}
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </ModalSheetFooter>
      )}
    </ModalSheet>,
    document.body
  );
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="relative block">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full h-10 pl-9 pr-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-orange-400"
      />
    </label>
  );
}

function Loading() {
  return (
    <div className="py-12 flex justify-center text-slate-400">
      <Loader2 className="w-6 h-6 animate-spin" />
    </div>
  );
}
