'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import { ArrowLeft, ChevronDown, ChevronRight, Loader2, School, Search, ShieldAlert } from 'lucide-react';
import type { Assignment, Classroom, ClassroomTeacher, Question, Submission, SubmissionAnswer, User } from '@/types/database';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { dataService } from '@/lib/supabase/dataService';
import { fetchCached, onCacheInvalidated, readCache, watchClassrooms } from '@/lib/cache/sessionCache';
import { GradingWorkspace } from '@/components/GradingWorkspace';
import { Avatar } from '@/components/Avatar';
import { GradingBar } from '@/components/AssignmentProgressCard';
import { isGraded, isHandedIn, isIntegrityFlagged, isMissing, isStudentSubmission, needsGrading, pendingLabel } from '@/lib/utils/gradingStatus';
import { countToGrade, isGroupWork } from '@/lib/utils/groupWork';
import { rosterFor } from '@/lib/utils/retake';

type Block = { assignment: Assignment; questions: Question[]; classroom: Classroom | null; subs: Submission[] };
type Row = { key: string; student: Partial<User> | undefined; submission: Submission | null };
type Filter = 'all' | 'pending' | 'graded' | 'missing';

const MAX_CLASSES = 40;
const fullName = (s?: Partial<User>) => `${s?.first_name || ''} ${s?.last_name || ''}`.trim() || s?.name || '-';

/** Roster order, then hand-ins from students no longer on the roster (same rule as the class grading page). */
function rowsOf(block: Block): Row[] {
  const used = new Set<string>();
  const rows: Row[] = rosterFor(block.assignment, block.classroom?.students || []).map((std) => {
    const sub = block.subs.find((s) => !used.has(s.id) && isStudentSubmission(s, std));
    if (sub) used.add(sub.id);
    return { key: `${block.assignment.id}:${std.id}`, student: sub?.student || std, submission: sub || null };
  });
  for (const sub of block.subs) if (!used.has(sub.id)) rows.push({ key: `${block.assignment.id}:${sub.id}`, student: sub.student, submission: sub });
  return rows;
}

/**
 * Every student of one work across all its classrooms, each classroom in its
 * own section, graded right here with the usual grading workspace ("next"
 * runs through every class). The per-class page stays one tap away for the
 * class-only tools (reopen, record no submission…).
 */
export function CombinedGrading() {
  const { tr } = useLanguage();
  const search = useSearchParams();
  const { user } = useUser();
  const teacherId = user?.id;
  const ids = useMemo(() => [...new Set((search.get('ids') || '').split(',').filter(Boolean))].slice(0, MAX_CLASSES), [search]);
  const idsKey = ids.join(',');
  const returnParam = search.get('returnTo');
  const backHref = returnParam?.startsWith('/works') ? returnParam : '/works';

  const [blocks, setBlocks] = useState<Block[] | null>(null);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<{ block: Block; submission: Submission; answers: Record<string, SubmissionAnswer> } | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  // No refetch while a student is open (the list would jump); refresh on close.
  const pausedRef = useRef(false);
  const seqRef = useRef(0);

  const load = useCallback(
    async (useCache: boolean) => {
      if (!teacherId || !ids.length) return;
      const key = `combinedGrading:${idsKey}`;
      const seq = ++seqRef.current;
      if (useCache) {
        const hit = readCache<Block[]>(key, teacherId);
        if (hit) {
          setBlocks(hit.value);
          if (hit.fresh) return;
        }
      }
      try {
        const next = await fetchCached(key, teacherId, () =>
          Promise.all(
            ids.map(async (id) => {
              const [detail, subs] = await Promise.all([dataService.getAssignmentById(id, { withClassroom: true }), dataService.getSubmissions(id)]);
              return detail.assignment ? { assignment: detail.assignment, questions: detail.questions, classroom: detail.classroom || null, subs } : null;
            })
          ).then((list) => list.filter(Boolean) as Block[])
        );
        if (seq !== seqRef.current) return;
        setBlocks(next);
        setError(false);
        watchClassrooms(next.map((b) => b.classroom?.id));
      } catch (err) {
        console.error(err);
        if (seq === seqRef.current) setError(true);
      }
    },
    [teacherId, ids, idsKey]
  );

  useEffect(() => {
    // Shows this session's copy at once on purpose, then fetches if it may be stale.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(true);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = onCacheInvalidated(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!pausedRef.current) void load(false);
      }, 600);
    });
    return () => {
      clearTimeout(timer);
      off();
    };
  }, [load]);

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (blocks || [])
      .map((block) => {
        const all = rowsOf(block);
        const rows = all.filter(({ student, submission: sub }) => {
          if (q && !`${fullName(student)} ${student?.student_id || ''}`.toLowerCase().includes(q)) return false;
          if (filter === 'pending') return !!sub && needsGrading(sub);
          if (filter === 'graded') return !!sub && isGraded(sub);
          if (filter === 'missing') return isMissing(sub);
          return true;
        });
        const handedIn = all.filter((r) => r.submission && isHandedIn(r.submission)).length;
        const waiting = all.flatMap((r) => (r.submission && needsGrading(r.submission) ? [r.submission] : []));
        const pending = waiting.length;
        // งานกลุ่ม: a group's hand-in is graded once for all its members.
        const pendingItems = countToGrade(waiting, isGroupWork(block.assignment));
        const graded = all.filter((r) => r.submission && isGraded(r.submission)).length;
        return { block, all, rows, handedIn, pending, pendingItems, graded, missing: all.filter((r) => isMissing(r.submission)).length };
      })
      .sort((a, b) => (a.block.classroom?.name || '').localeCompare(b.block.classroom?.name || '', 'th', { numeric: true }));
  }, [blocks, filter, query]);

  const totals = sections.reduce(
    (t, s) => ({
      all: t.all + s.all.length,
      pending: t.pending + s.pending,
      pendingItems: t.pendingItems + s.pendingItems,
      graded: t.graded + s.graded,
      missing: t.missing + s.missing,
      handedIn: t.handedIn + s.handedIn,
    }),
    { all: 0, pending: 0, pendingItems: 0, graded: 0, missing: 0, handedIn: 0 }
  );

  // "Next" runs through every class's hand-ins in the order shown.
  const order = sections.flatMap((s) => s.rows.flatMap((r) => (r.submission && isHandedIn(r.submission) ? [{ block: s.block, submission: r.submission }] : [])));
  const index = open ? order.findIndex((o) => o.submission.id === open.submission.id) : -1;

  const graderFor = (classroom: Classroom | null): ClassroomTeacher | null => {
    if (!user || !classroom) return null;
    const entry = classroom.teachers?.find((t) => t.teacher_id === user.id);
    if (!entry && classroom.teacher_id !== user.id) return null;
    return {
      teacher_id: user.id,
      name: entry?.name || user.fullName || tr('คุณครู', 'Teacher'),
      email: entry?.email || user.primaryEmailAddress?.emailAddress,
      avatar_url: user.imageUrl || entry?.avatar_url,
      role: entry?.role || 'primary',
    };
  };

  const openStudent = async (block: Block, submission: Submission) => {
    setOpening(submission.id);
    pausedRef.current = true;
    let answers: Record<string, SubmissionAnswer> = {};
    try {
      answers = await dataService.getSubmissionAnswers(submission.id);
    } catch {
      answers = {};
    }
    setOpening(null);
    setOpen({ block, submission, answers });
  };
  const closeStudent = () => {
    setOpen(null);
    pausedRef.current = false;
    void load(false);
  };
  const showTotal = (submissionId: string, total: number | null, max: number) =>
    setBlocks((prev) =>
      (prev || []).map((b) => ({ ...b, subs: b.subs.map((s) => (s.id === submissionId ? { ...s, total_score: total ?? undefined, max_total_score: max || s.max_total_score } : s)) }))
    );

  const first = blocks?.[0]?.assignment;
  const FILTERS: Array<{ id: Filter; label: string; count: number }> = [
    { id: 'all', label: tr('ทั้งหมด', 'All'), count: totals.all },
    { id: 'pending', label: tr('รอตรวจ', 'To grade'), count: totals.pending },
    { id: 'graded', label: tr('ตรวจแล้ว', 'Graded'), count: totals.graded },
    { id: 'missing', label: tr('ยังไม่ส่ง', 'Missing'), count: totals.missing },
  ];
  const grader = open ? graderFor(open.block.classroom) : null;

  return (
    <div className="max-w-5xl mx-auto space-y-4 sm:space-y-5 pb-24">
      <Link href={backHref} className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-amber-600 dark:text-slate-400 dark:hover:text-amber-400">
        <ArrowLeft className="w-3.5 h-3.5" />
        {tr('กลับไปรายการงาน', 'Back to work list')}
      </Link>

      {!blocks && !error ? (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <div key={i} className="h-40 rounded-3xl bg-slate-100 dark:bg-slate-800/60 animate-pulse" />
          ))}
        </div>
      ) : error && !blocks ? (
        <div className="p-6 rounded-3xl bg-rose-50 dark:bg-rose-950/30 text-sm font-semibold text-rose-700 dark:text-rose-300 text-center">{tr('โหลดข้อมูลไม่สำเร็จ ลองรีเฟรชหน้า', 'Could not load. Try refreshing.')}</div>
      ) : !first ? (
        <div className="p-6 rounded-3xl bg-slate-50 dark:bg-slate-900 text-sm font-semibold text-slate-500 text-center">{tr('ไม่พบงานนี้ อาจถูกลบไปแล้ว', 'This work no longer exists')}</div>
      ) : (
        <>
          {/* What it is, and how far grading is across every class */}
          <div className="bg-white dark:bg-slate-900 p-3 sm:p-5 rounded-2xl sm:rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-2 sm:space-y-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`px-2 py-0.5 rounded-lg text-[11px] font-bold ${first.is_exam ? 'bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'}`}>
                {first.is_exam ? tr('ข้อสอบ', 'Quiz') : tr('การบ้าน', 'Homework')}
              </span>
              <span className="px-2 py-0.5 rounded-lg bg-slate-900 text-white dark:bg-white dark:text-slate-900 text-[11px] font-black">
                {tr(`${sections.length} ห้อง`, `${sections.length} classes`)}
              </span>
            </div>
            <h1 className="text-base sm:text-2xl font-black text-slate-900 dark:text-white leading-snug wrap-break-word">{first.title}</h1>
            <div className="space-y-1.5">
              <GradingBar graded={totals.graded} pending={totals.pending} notSubmitted={Math.max(0, totals.all - totals.handedIn)} />
              <p className="text-[11px] sm:text-xs font-semibold text-slate-500 dark:text-slate-400 tabular-nums">
                {tr(`ส่งแล้ว ${totals.handedIn}/${totals.all} · ตรวจแล้ว ${totals.graded}`, `${totals.handedIn}/${totals.all} handed in · ${totals.graded} graded`)}
                {totals.pending > 0 && <span className="text-amber-700 dark:text-amber-400 font-bold">{tr(` · รอตรวจ ${pendingLabel(totals.pendingItems, totals.pending, true)}`, ` · ${pendingLabel(totals.pendingItems, totals.pending, false)} to grade`)}</span>}
              </p>
            </div>
          </div>

          {/* Filter + search */}
          <div className="flex flex-row gap-2">
            {/* Phones: the filter as one dropdown, left of the search. */}
            <label className="sm:hidden relative shrink-0 w-[42%] h-9 pl-2.5 pr-7 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center text-[11px] font-bold text-slate-800 dark:text-slate-100 focus-within:border-amber-500">
              <span className="truncate">
                {(() => {
                  const f = FILTERS.find((x) => x.id === filter);
                  return f ? `${f.label} (${f.count})` : '';
                })()}
              </span>
              <ChevronDown className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value as typeof filter)}
                aria-label={tr('กรองตามสถานะ', 'Filter by status')}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              >
                {FILTERS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label} ({f.count})
                  </option>
                ))}
              </select>
            </label>
            <div className="max-sm:hidden flex gap-1.5 overflow-x-auto scrollbar-none">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  aria-pressed={filter === f.id}
                  className={`shrink-0 h-9 px-3 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                    filter === f.id ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:border-amber-400'
                  }`}
                >
                  {f.label}
                  <span className="tabular-nums opacity-70">{f.count}</span>
                </button>
              ))}
            </div>
            <label className="relative block min-w-0 flex-1 sm:flex-none sm:w-64 sm:ml-auto">
              <Search className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={tr('ค้นหาชื่อ / เลขที่', 'Name or number')}
                className="w-full h-9 pl-8 sm:pl-9 pr-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs sm:text-sm text-slate-900 dark:text-white focus:outline-hidden focus:border-amber-500"
              />
            </label>
          </div>

          {/* One section per classroom, clearly apart */}
          <div className="space-y-3 sm:space-y-5">
            {sections.map((s) => {
              const cls = s.block.classroom;
              return (
                <section key={s.block.assignment.id} className="rounded-2xl sm:rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
                  <header className="flex flex-wrap items-center gap-x-2 sm:gap-x-3 gap-y-1 px-3 sm:px-4 py-2 sm:py-3 bg-slate-100/80 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800">
                    <span className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg sm:rounded-xl bg-amber-500 text-slate-950 flex items-center justify-center shrink-0">
                      <School className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    </span>
                    <h2 className="min-w-0 flex-1 text-sm sm:text-base font-black text-slate-900 dark:text-white truncate">{cls?.name || s.block.assignment.classroom_name}</h2>
                    <span className="max-sm:order-last max-sm:basis-full max-sm:pl-9 text-[11px] sm:text-xs font-semibold text-slate-500 dark:text-slate-400 tabular-nums">
                      {tr(`ส่ง ${s.handedIn}/${s.all.length} · ตรวจ ${s.graded}`, `${s.handedIn}/${s.all.length} in · ${s.graded} graded`)}
                      {s.pending > 0 && <span className="ml-1 px-1.5 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 font-black">{tr(`รอ ${s.pending}`, `${s.pending} left`)}</span>}
                    </span>
                    <Link
                      href={`/assignments/${s.block.assignment.id}/grading?from=works&returnTo=${encodeURIComponent(backHref)}`}
                      className="shrink-0 text-[11px] sm:text-xs font-bold text-amber-700 dark:text-amber-400 hover:underline inline-flex items-center gap-0.5"
                    >
                      {tr('หน้าของห้องนี้', 'This class only')}
                      <ChevronRight className="w-3.5 h-3.5" />
                    </Link>
                  </header>
                  {s.rows.length === 0 ? (
                    <p className="px-4 py-5 text-xs text-slate-400 text-center">{tr('ไม่มีนักเรียนตามที่เลือก', 'No students match')}</p>
                  ) : (
                    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                      {s.rows.map(({ key, student, submission: sub }) => {
                        const handed = !!sub && isHandedIn(sub);
                        const waiting = !!sub && needsGrading(sub);
                        const done = !!sub && isGraded(sub);
                        const flagged = !!sub && isIntegrityFlagged(sub, s.block.assignment.is_exam);
                        return (
                          <li key={key} className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 sm:py-2.5">
                            <Avatar src={student?.avatar_url} name={fullName(student)} firstName={student?.first_name} lastName={student?.last_name} className="w-8 h-8 text-xs shrink-0" />
                            <div className="min-w-0 flex-1">
                              <p className="text-[13px] sm:text-sm font-bold leading-tight text-slate-900 dark:text-white truncate">{fullName(student)}</p>
                              {student?.student_id && <p className="text-[10px] sm:text-[11px] text-slate-400 tabular-nums">{student.student_id}</p>}
                            </div>
                            {flagged && (
                              <span className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 text-[10px] font-bold">
                                <ShieldAlert className="w-3 h-3" />
                              </span>
                            )}
                            {sub?.status === 'late' && <span className="shrink-0 text-[10px] font-bold text-orange-600 dark:text-orange-400">{tr('ส่งช้า', 'Late')}</span>}
                            <span
                              className={`shrink-0 w-14 text-right text-[11px] sm:text-xs font-black tabular-nums ${done ? 'text-emerald-600 dark:text-emerald-400' : waiting ? 'text-amber-700 dark:text-amber-400' : 'text-slate-400'}`}
                            >
                              {done ? `${sub?.total_score ?? 0}/${sub?.max_total_score ?? '-'}` : waiting ? tr('รอตรวจ', 'To grade') : tr('ยังไม่ส่ง', 'Missing')}
                            </span>
                            {handed ? (
                              <button
                                type="button"
                                onClick={() => sub && openStudent(s.block, sub)}
                                disabled={opening === sub?.id}
                                className={`shrink-0 h-8 w-16 sm:w-20 rounded-xl text-[11px] sm:text-xs font-black inline-flex items-center justify-center gap-1 cursor-pointer transition-colors ${
                                  waiting ? 'bg-amber-500 hover:bg-amber-600 text-slate-950' : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200'
                                }`}
                              >
                                {opening === sub?.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : waiting ? tr('ตรวจ', 'Grade') : tr('แก้คะแนน', 'Edit')}
                              </button>
                            ) : (
                              <span className="shrink-0 w-16 sm:w-20" />
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        </>
      )}

      {open && grader && (
        <GradingWorkspace
          key={open.submission.id}
          submission={open.submission}
          questions={open.block.questions}
          initialAnswers={open.answers}
          grader={grader}
          tracksAway={!!open.block.assignment.is_exam}
          isSurvey={!!open.block.assignment.is_survey}
          studentPosition={index >= 0 ? { index, total: order.length } : undefined}
          onClose={closeStudent}
          onPrevStudent={index > 0 ? () => openStudent(order[index - 1].block, order[index - 1].submission) : undefined}
          onNextStudent={index >= 0 && index < order.length - 1 ? () => openStudent(order[index + 1].block, order[index + 1].submission) : undefined}
          onGraded={(total, max) => showTotal(open.submission.id, total, max)}
          onSaveGrades={(subId, grades, teacher) => dataService.saveTeacherGrades(subId, grades, teacher.name)}
          onUpdateAnswerKey={async (questionId, idealAnswer) => {
            const result = await dataService.updateAnswerKey(open.block.assignment.id, questionId, idealAnswer);
            const fix = (b: Block) => ({ ...b, questions: b.questions.map((q) => (q.id === questionId ? { ...q, ideal_answer: result.question.ideal_answer } : q)) });
            setOpen((cur) => (cur ? { ...cur, block: fix(cur.block) } : cur));
            setBlocks((prev) => (prev || []).map((b) => (b.assignment.id === open.block.assignment.id ? fix(b) : b)));
            return result;
          }}
        />
      )}
    </div>
  );
}
