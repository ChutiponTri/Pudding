'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import {
  X,
  BookOpen,
  Plus,
  LayoutDashboard,
  GraduationCap,
  Sparkles,
  Users,
  ListChecks,
  UserPlus,
  Home,
  ChevronDown,
  GripVertical,
  CalendarCog,
} from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { dataService, CLASSROOMS_CHANGED_EVENT } from '@/lib/supabase/dataService';
import { Classroom } from '@/types/database';
import { useSidebar } from '@/components/SidebarContext';
import { SemesterSelect } from '@/components/SemesterSelect';
import { useAcademicCalendar } from '@/lib/hooks/useAcademicCalendar';
import { TermDatesSettings } from '@/components/TermDatesSettings';
import { ALL_SEMESTERS, filterClassroomsBySemester, semesterKeyFromParam, semesterKeyOf, semesterOptions } from '@/lib/utils/semesterFilter';
import { applySavedOrder, mergeVisibleOrder, useSidebarPrefs } from '@/lib/hooks/useSidebarPrefs';

/** Subject group key for classrooms with neither a course name nor a code. */
const GENERAL_KEY = '__general__';

type CourseGroup = { key: string; label: string; items: Classroom[] };

/** Short "term/year" label, e.g. "เทอม 1/2568", so the same room in another year is told apart. */
function periodLabel(cls: Classroom, th: boolean): string {
  const term = cls.semester === 3 ? (th ? 'ซัมเมอร์' : 'Summer') : cls.semester ? `${th ? 'เทอม' : 'Term'} ${cls.semester}` : '';
  const year = cls.year_ce ? String(cls.year_ce + 543) : cls.academic_year || '';
  return [term, year].filter(Boolean).join('/');
}

/** Sidebar body for signed-out visitors: no classroom data, just ways in. */
const GuestSidebarContent: React.FC<{ onNavigate: () => void }> = ({ onNavigate }) => {
  const { language } = useLanguage();
  const th = language === 'th';

  const links = [
    { href: '/', icon: <Home className="w-4 h-4" />, label: th ? 'หน้าแรก' : 'Home' },
    { href: '/#how-it-works', icon: <ListChecks className="w-4 h-4" />, label: th ? 'เริ่มต้นใช้งาน' : 'Getting started' },
    { href: '/#features', icon: <Sparkles className="w-4 h-4" />, label: th ? 'ฟีเจอร์' : 'Features' },
  ];

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-4 overflow-x-hidden min-w-0">
        {/* Sign-in card */}
        <div className="rounded-2xl bg-linear-to-br from-amber-300 via-amber-400 to-orange-400 p-4 text-slate-950 space-y-3">
          <div className="space-y-1">
            <p className="text-sm font-black">{th ? 'ยินดีต้อนรับสู่พุดดิ้ง' : 'Welcome to Pudding'}</p>
            <p className="text-xs font-medium text-slate-950/75 leading-relaxed">
              {th ? 'เข้าสู่ระบบเพื่อดูห้องเรียน รายวิชา และงานของคุณครู' : 'Sign in to see your classes, courses and work.'}
            </p>
          </div>
          <Link
            href="/sign-in"
            onClick={onNavigate}
            className="w-full h-11 rounded-xl bg-[#06C755] hover:bg-[#05b34c] text-white text-sm font-bold flex items-center justify-center gap-2 shadow-sm shadow-emerald-700/25 transition-all active:scale-[0.98]"
          >
            {th ? 'เข้าสู่ระบบด้วย LINE' : 'Sign in with LINE'}
          </Link>
          <Link
            href="/sign-up"
            onClick={onNavigate}
            className="w-full h-10 rounded-xl bg-white/80 hover:bg-white text-slate-950 text-xs font-bold flex items-center justify-center gap-1.5 transition-all active:scale-[0.98]"
          >
            <UserPlus className="w-3.5 h-3.5" />
            {th ? 'ครูใหม่? สมัครใช้งาน' : 'New teacher? Sign up'}
          </Link>
        </div>

        {/* Page sections */}
        <nav className="space-y-1">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={onNavigate}
              className="flex items-center gap-3 min-h-11 px-3 py-2.5 rounded-xl text-sm font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white transition-all"
            >
              <span className="w-7 h-7 rounded-lg bg-amber-100 dark:bg-amber-950/70 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                {link.icon}
              </span>
              <span className="truncate">{link.label}</span>
            </Link>
          ))}
        </nav>

        {/* Students land here by mistake: point them back to LINE */}
        <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 ring-1 ring-slate-200/80 dark:ring-slate-800 space-y-1">
          <p className="text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
            <GraduationCap className="w-3.5 h-3.5 text-amber-500" />
            {th ? 'สำหรับนักเรียน' : 'For students'}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
            {th
              ? 'นักเรียนไม่ต้องเข้าสู่ระบบที่นี่ ใช้ลิงก์ LINE ที่คุณครูส่งให้ในกลุ่มห้องเรียน'
              : "Students don't sign in here. Use the LINE link your teacher shared in the class group."}
          </p>
        </div>
    </div>
  );
};

/** Last list per browser tab, so a reload paints the sidebar at once while it refreshes. */
const LIST_CACHE_KEY = 'pudding_sidebar_classrooms_v2';

function readCachedList(teacherId: string): Classroom[] | null {
  try {
    const cached = JSON.parse(window.sessionStorage.getItem(LIST_CACHE_KEY) || 'null');
    return cached?.teacherId === teacherId && Array.isArray(cached.items) ? cached.items : null;
  } catch {
    return null;
  }
}

function writeCachedList(teacherId: string, items: Classroom[]) {
  try {
    window.sessionStorage.setItem(LIST_CACHE_KEY, JSON.stringify({ teacherId, items }));
  } catch {}
}

export const GlobalClassroomSidebar: React.FC = () => {
  const { tr, language } = useLanguage();
  const pathname = usePathname();
  const { isOpen, closeSidebar } = useSidebar();
  // Tagged with the teacher it was fetched for, so a different session never sees it.
  const [list, setList] = useState<{ teacherId: string; items: Classroom[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const { user, isLoaded } = useUser();
  const teacherId = user?.id;

  // Bumped whenever the classroom list may have changed (create/edit/delete,
  // roster changes) so the list refetches in the background.
  const [listVersion, setListVersion] = useState(0);
  // `${teacherId}:${listVersion}` of the last fetch; toggling the sidebar
  // reuses the cached list instead of refetching.
  const loadedKey = useRef<string | null>(null);

  useEffect(() => {
    const bump = () => setListVersion((v) => v + 1);
    const events = [CLASSROOMS_CHANGED_EVENT, 'pudding_student_enrolled', 'pudding_student_admitted', 'pudding_student_rejected'];
    events.forEach((name) => window.addEventListener(name, bump));
    return () => events.forEach((name) => window.removeEventListener(name, bump));
  }, []);

  // Load only the signed-in teacher's classrooms (owner or co-teacher), the
  // same scope the dashboard uses. Fetch in the background as soon as the
  // session is known, so the list is ready by the first open, then only when
  // the session or the classroom list changes. The LIFF app has no sidebar.
  const onLiff = pathname.startsWith('/liff');
  useEffect(() => {
    if (onLiff || !isLoaded || !teacherId) return;
    const key = `${teacherId}:${listVersion}`;
    if (loadedKey.current === key) return;
    loadedKey.current = key;

    let cancelled = false;
    let settled = false;
    setLoading(true);
    dataService
      .getClassroomList()
      .then((data) => {
        writeCachedList(teacherId, data);
        if (!cancelled) setList({ teacherId, items: data });
      })
      .catch((err) => {
        console.warn('Failed to load classrooms for sidebar:', err);
        // Allow a retry on the next session or list change.
        if (!cancelled) loadedKey.current = null;
      })
      .finally(() => {
        settled = true;
        if (!cancelled) setLoading(false);
      });
    return () => {
      if (settled) return;
      cancelled = true;
      setLoading(false);
      // Superseded mid-request: let the next run fetch again.
      if (loadedKey.current === key) loadedKey.current = null;
    };
  }, [onLiff, isLoaded, teacherId, listVersion]);

  // Signed out or another teacher: show nothing rather than a previous teacher's list.
  // Before the first fetch returns, this tab's cached list paints at once (the
  // sidebar renders nothing until it opens after mount, so hydration is unaffected).
  const allClassrooms = useMemo(
    () => (!teacherId ? [] : list?.teacherId === teacherId ? list.items : readCachedList(teacherId) || []),
    [list, teacherId]
  );

  // Term filter: the dashboard's options and filter. The list already carries
  // each classroom's effective term (its course's when it has none), so no
  // course data is needed here.
  const { prefs, update: updatePrefs } = useSidebarPrefs(teacherId);
  const { currentPeriod } = useAcademicCalendar();
  const [isTermDatesOpen, setIsTermDatesOpen] = useState(false);
  const termOptions = useMemo(() => semesterOptions([], allClassrooms, currentPeriod.yearCE), [allClassrooms, currentPeriod.yearCE]);
  const currentTermKey = semesterKeyOf(currentPeriod.semester, currentPeriod.yearCE);
  const storedTerm = semesterKeyFromParam(prefs.term ?? null, currentTermKey);
  const termKey =
    storedTerm === ALL_SEMESTERS || termOptions.some((o) => semesterKeyOf(o.semester, o.yearCE) === storedTerm) ? storedTerm : currentTermKey;
  const filteredClassrooms = useMemo(
    () => filterClassroomsBySemester(allClassrooms, [], termKey, currentPeriod.yearCE),
    [allClassrooms, termKey, currentPeriod.yearCE]
  );

  // Group by subject. Subjects default to newest classroom first, then follow
  // the order the teacher dragged them into; classrooms inside are by name.
  const groupedCourses = useMemo(() => {
    const collator = new Intl.Collator(language === 'th' ? 'th' : 'en', { numeric: true, sensitivity: 'base' });
    const byNewest = [...filteredClassrooms].sort(
      (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
    );
    const map = new Map<string, CourseGroup>();
    for (const cls of byNewest) {
      const key = cls.course_name || cls.subject_code || GENERAL_KEY;
      if (!map.has(key)) map.set(key, { key, label: key === GENERAL_KEY ? tr('รายวิชาทั่วไป', 'General') : key, items: [] });
      map.get(key)!.items.push(cls);
    }
    const groups = Array.from(map.values());
    for (const group of groups) group.items.sort((a, b) => collator.compare(a.name || '', b.name || ''));
    return applySavedOrder(groups, (g) => g.key, prefs.order);
  }, [filteredClassrooms, language, tr, prefs.order]);

  // While dragging, the subjects show in this live order.
  const [dragOrder, setDragOrder] = useState<string[] | null>(null);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const groupRefs = useRef(new Map<string, HTMLElement>());
  const scrollRef = useRef<HTMLDivElement>(null);
  const visibleGroups = useMemo(() => {
    if (!dragOrder) return groupedCourses;
    const byKey = new Map(groupedCourses.map((g) => [g.key, g]));
    return dragOrder.map((key) => byKey.get(key)).filter((g): g is CourseGroup => !!g);
  }, [dragOrder, groupedCourses]);

  /** Saves a new order of the visible subjects, dropping keys of subjects that no longer exist. */
  const saveOrder = useCallback(
    (nextVisible: string[]) => {
      const before = groupedCourses.map((g) => g.key);
      if (nextVisible.join('\n') === before.join('\n')) return;
      const existing = new Set(allClassrooms.map((c) => c.course_name || c.subject_code || GENERAL_KEY));
      updatePrefs((p) => ({
        ...p,
        order: mergeVisibleOrder(p.order, before, nextVisible).filter((key) => !allClassrooms.length || existing.has(key)),
      }));
    },
    [groupedCourses, allClassrooms, updatePrefs]
  );

  const collapsed = useMemo(() => new Set(prefs.collapsed), [prefs.collapsed]);
  const toggleCollapsed = (key: string) =>
    updatePrefs((p) => ({
      ...p,
      collapsed: p.collapsed.includes(key) ? p.collapsed.filter((k) => k !== key) : [...p.collapsed, key],
    }));

  const moveBy = (key: string, delta: number) => {
    const keys = groupedCourses.map((g) => g.key);
    const from = keys.indexOf(key);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= keys.length) return;
    keys.splice(to, 0, keys.splice(from, 1)[0]);
    saveOrder(keys);
  };

  // Pointer drag on the grip: works the same for mouse, pen and touch. The
  // dragged subject swaps with a neighbour once the pointer passes that
  // neighbour's middle, and the list scrolls near its edges.
  const onGripPointerDown = (e: React.PointerEvent<HTMLButtonElement>, key: string) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDraggingKey(key);
    setDragOrder(groupedCourses.map((g) => g.key));
  };

  const onGripPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!draggingKey || !dragOrder) return;
    const y = e.clientY;
    const scroller = scrollRef.current;
    if (scroller) {
      const box = scroller.getBoundingClientRect();
      if (y < box.top + 48) scroller.scrollBy({ top: -10 });
      else if (y > box.bottom - 48) scroller.scrollBy({ top: 10 });
    }
    const index = dragOrder.indexOf(draggingKey);
    const middle = (key?: string) => {
      const rect = key ? groupRefs.current.get(key)?.getBoundingClientRect() : undefined;
      return rect ? rect.top + rect.height / 2 : null;
    };
    const above = middle(dragOrder[index - 1]);
    const below = middle(dragOrder[index + 1]);
    let target = index;
    if (above !== null && y < above) target = index - 1;
    else if (below !== null && y > below) target = index + 1;
    if (target === index) return;
    const next = [...dragOrder];
    next.splice(target, 0, next.splice(index, 1)[0]);
    setDragOrder(next);
  };

  const endDrag = (commit: boolean) => {
    if (commit && dragOrder) saveOrder(dragOrder);
    setDragOrder(null);
    setDraggingKey(null);
  };

  const onGripKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, key: string) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      moveBy(key, e.key === 'ArrowUp' ? -1 : 1);
      // Keep focus on the moved grip after the re-render.
      requestAnimationFrame(() => groupRefs.current.get(key)?.querySelector<HTMLButtonElement>('[data-grip]')?.focus());
    }
  };

  const handleItemClick = () => {
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      closeSidebar();
    }
  };

  const isGuest = isLoaded && !user;

  // Do not render on LIFF student portal
  if (!isOpen || pathname.startsWith('/liff')) return null;

  return (
    <>
      {/* Drawer backdrop on phones and iPads (< 1024px); desktop keeps the page visible beside the sidebar */}
      <div
        className="fixed inset-0 bg-slate-950/50 backdrop-blur-xs z-40 lg:hidden animate-in fade-in duration-200"
        onClick={closeSidebar}
        aria-hidden="true"
      />

      {/* Sidebar Container: Fixed on left (w-80) */}
      <aside className="fixed inset-y-0 left-0 w-80 max-w-[86vw] bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border-r border-slate-200/80 dark:border-slate-800 shadow-2xl lg:shadow-none flex flex-col z-50 animate-in slide-in-from-left duration-300 select-none overflow-hidden pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
        {/* Header */}
        <div className="h-16 px-4 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between shrink-0">
          {/* Same destination as the navbar brand logo */}
          <Link href={user ? '/dashboard' : '/'} onClick={handleItemClick} className="flex items-center gap-2.5 min-w-0 group">
            <div className="w-9 h-9 rounded-2xl bg-linear-to-tr from-amber-600 via-amber-500 to-yellow-400 flex items-center justify-center font-bold text-base shadow-md shadow-amber-500/25 group-hover:scale-105 group-hover:-rotate-3 transition-all duration-300 shrink-0">
              🍮
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-black text-slate-900 dark:text-white truncate">{isGuest ? tr('พุดดิ้ง', 'Pudding') : tr('ห้องเรียนและรายวิชา', 'Classrooms & courses')}</h2>
              <p className="text-[10px] text-slate-500 font-medium truncate">{isGuest ? tr('สำหรับคุณครูผู้สอน', 'For teachers') : tr('รายวิชาทั้งหมด', 'All courses')}</p>
            </div>
          </Link>
          <button
            onClick={closeSidebar}
            className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors cursor-pointer shrink-0"
            aria-label="Close sidebar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {isGuest ? (
          <GuestSidebarContent onNavigate={handleItemClick} />
        ) : (
        <>
        {/* Quick Actions Shortcuts */}
        <div className="p-3 grid grid-cols-2 gap-2 shrink-0">
          <Link
            href="/dashboard"
            onClick={handleItemClick}
            className="px-3 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700/80 text-slate-700 dark:text-slate-200 text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer truncate"
          >
            <LayoutDashboard className="w-3.5 h-3.5 text-amber-600 shrink-0" />
            <span className="truncate">{tr('แดชบอร์ด', 'Dashboard')}</span>
          </Link>
          <Link
            href="/assignments/new"
            onClick={handleItemClick}
            className="px-3 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-sm shadow-amber-500/30 active:scale-[0.98] truncate"
          >
            <Plus className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{tr('สร้างงาน/สอบ', 'New assignment/exam')}</span>
          </Link>
        </div>

        {/* Term filter (same options and rule as the dashboard) and counts */}
        <section className="mx-3 mb-2 p-2.5 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/40 space-y-2 shrink-0" aria-label={tr('ภาคเรียน', 'Term')}>
          <div className="flex items-center justify-between gap-2 px-0.5 min-h-5">
            <span className="flex items-center gap-1">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500">
                {tr('ภาคเรียน', 'Term')}
              </span>
              <button
                type="button"
                onClick={() => setIsTermDatesOpen(true)}
                title={tr('ตั้งค่าวันเปิดภาคเรียน', 'Set term dates')}
                aria-label={tr('ตั้งค่าวันเปิดภาคเรียน', 'Set term dates')}
                className="p-1 -m-0.5 rounded-md text-slate-400 hover:text-amber-600 hover:bg-white dark:hover:bg-slate-900 cursor-pointer"
              >
                <CalendarCog className="w-3.5 h-3.5" />
              </button>
            </span>
            {termKey === currentTermKey ? (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/50 text-[10px] font-bold text-emerald-700 dark:text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                {tr('ปัจจุบัน', 'Current')}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => updatePrefs((p) => ({ ...p, term: currentTermKey }))}
                className="text-[10px] font-bold text-amber-700 dark:text-amber-400 hover:underline cursor-pointer"
              >
                {tr('กลับภาคเรียนปัจจุบัน', 'Back to current')}
              </button>
            )}
          </div>
          <SemesterSelect
            compact
            value={termKey}
            onChange={(key) => updatePrefs((p) => ({ ...p, term: key }))}
            options={termOptions}
            currentPeriod={currentPeriod}
          />
          <div className="grid grid-cols-2 gap-1.5 text-[11px] font-bold text-slate-600 dark:text-slate-300">
            <span className="h-8 px-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 flex items-center justify-center gap-1.5 min-w-0">
              <GraduationCap className="w-3.5 h-3.5 text-amber-500 shrink-0" aria-hidden="true" />
              <span className="tabular-nums text-slate-900 dark:text-white">{filteredClassrooms.length}</span>
              <span className="truncate">{tr('ห้องเรียน', filteredClassrooms.length === 1 ? 'classroom' : 'classrooms')}</span>
            </span>
            <span className="h-8 px-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 flex items-center justify-center gap-1.5 min-w-0">
              <BookOpen className="w-3.5 h-3.5 text-amber-500 shrink-0" aria-hidden="true" />
              <span className="tabular-nums text-slate-900 dark:text-white">{groupedCourses.length}</span>
              <span className="truncate">{tr('รายวิชา', groupedCourses.length === 1 ? 'course' : 'courses')}</span>
            </span>
          </div>
        </section>
        {isTermDatesOpen && <TermDatesSettings onClose={() => setIsTermDatesOpen(false)} />}

        {/* Classrooms List: Smooth Scroll with no horizontal overflow */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2 overflow-x-hidden min-w-0">
          {(!isLoaded || loading) && allClassrooms.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400 space-y-2">
              <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto" />
              <p>{tr('กำลังโหลดห้องเรียน...', 'Loading classrooms...')}</p>
            </div>
          ) : filteredClassrooms.length === 0 ? (
            <div className="p-5 sm:p-8 text-center bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-200/80 dark:border-slate-800 text-xs text-slate-400 space-y-2">
              <GraduationCap className="w-8 h-8 text-slate-300 mx-auto" />
              <p>
                {allClassrooms.length === 0
                  ? tr('ยังไม่มีห้องเรียนในระบบ', 'No classrooms yet')
                  : tr('ไม่มีห้องเรียนในภาคเรียนนี้', 'No classrooms in this term')}
              </p>
              {allClassrooms.length > 0 && termKey !== ALL_SEMESTERS && (
                <button
                  type="button"
                  onClick={() => updatePrefs((p) => ({ ...p, term: ALL_SEMESTERS }))}
                  className="min-h-11 px-3 rounded-xl text-xs font-bold text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/50 cursor-pointer"
                >
                  {tr('ดูทุกภาคเรียน', 'Show all terms')}
                </button>
              )}
            </div>
          ) : (
            visibleGroups.map((group) => {
              const isCollapsed = collapsed.has(group.key);
              const isDragging = draggingKey === group.key;
              const hasActive = group.items.some((cls) => pathname.startsWith(`/classrooms/${cls.id}`));
              const listId = `sidebar-course-${group.key}`;
              return (
                <div
                  key={group.key}
                  ref={(el) => {
                    if (el) groupRefs.current.set(group.key, el);
                    else groupRefs.current.delete(group.key);
                  }}
                  className={`min-w-0 rounded-2xl transition-shadow ${
                    isDragging ? 'relative z-10 bg-white dark:bg-slate-900 shadow-xl shadow-slate-900/15 ring-2 ring-amber-400/80' : ''
                  }`}
                >
                  <div className="flex items-center gap-0.5 min-w-0">
                    <button
                      type="button"
                      data-grip
                      onPointerDown={(e) => onGripPointerDown(e, group.key)}
                      onPointerMove={onGripPointerMove}
                      onPointerUp={() => endDrag(true)}
                      onPointerCancel={() => endDrag(false)}
                      onKeyDown={(e) => onGripKeyDown(e, group.key)}
                      aria-label={tr(`ลากเพื่อจัดลำดับ ${group.label} (หรือกดลูกศรขึ้น/ลง)`, `Drag to reorder ${group.label} (or press arrow up/down)`)}
                      title={tr('ลากเพื่อจัดลำดับ', 'Drag to reorder')}
                      className={`w-7 min-h-11 lg:min-h-9 flex items-center justify-center rounded-lg text-slate-300 dark:text-slate-600 hover:text-slate-500 dark:hover:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-amber-500 shrink-0 touch-none ${
                        isDragging ? 'cursor-grabbing text-amber-500' : 'cursor-grab'
                      }`}
                    >
                      <GripVertical className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleCollapsed(group.key)}
                      aria-expanded={!isCollapsed}
                      aria-controls={listId}
                      title={group.label}
                      className="flex-1 min-w-0 min-h-11 lg:min-h-9 pl-1 pr-2 py-1.5 rounded-xl flex items-center justify-between gap-2 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer text-left"
                    >
                      <span className="text-sm font-black text-slate-900 dark:text-white truncate flex items-center gap-2 min-w-0">
                        <span className="relative w-7 h-7 rounded-lg bg-amber-100 dark:bg-amber-950/70 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                          <BookOpen className="w-4 h-4" />
                          {isCollapsed && hasActive && (
                            <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-amber-500 ring-2 ring-white dark:ring-slate-900" />
                          )}
                        </span>
                        <span className="truncate">{group.label}</span>
                      </span>
                      <span className="flex items-center gap-1 shrink-0">
                        <span className="px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-[11px] font-bold text-slate-500 dark:text-slate-400 tabular-nums">
                          {group.items.length}
                        </span>
                        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isCollapsed ? '-rotate-90' : ''}`} />
                      </span>
                    </button>
                  </div>

                  {!isCollapsed && (
                    <div id={listId} className="mt-1 mb-2 space-y-1 pl-2 ml-[2.6rem] border-l border-slate-200 dark:border-slate-800 min-w-0">
                      {group.items.map((cls) => {
                        const isActive = pathname.startsWith(`/classrooms/${cls.id}`);
                        const studentCount = cls.student_count || cls.students?.length || 0;
                        const period = periodLabel(cls, language === 'th');

                        return (
                          <Link
                            key={cls.id}
                            href={`/classrooms/${cls.id}`}
                            onClick={handleItemClick}
                            title={cls.name}
                            className={`flex items-center justify-between min-h-11 px-3 py-2.5 rounded-xl text-sm font-bold transition-all cursor-pointer min-w-0 ${
                              isActive
                                ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200 ring-1 ring-amber-300/80 dark:ring-amber-700/70'
                                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <span className={`w-2 h-2 rounded-full shrink-0 ${isActive ? 'bg-amber-500' : 'bg-slate-300 dark:bg-slate-600'}`} />
                              <span className="min-w-0">
                                <span className="block truncate">{cls.name}</span>
                                {period && (
                                  <span className={`block text-[11px] font-semibold leading-tight ${isActive ? 'text-amber-700 dark:text-amber-400' : 'text-slate-400'}`}>
                                    {period}
                                  </span>
                                )}
                              </span>
                            </div>
                            <span className="text-xs text-slate-400 font-semibold shrink-0 ml-2 flex items-center gap-1 tabular-nums">
                              <Users className="w-3.5 h-3.5" />
                              <span>{studentCount}</span>
                            </span>
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
        </>
        )}

        {/* Footer */}
        <div className="p-3 border-t border-slate-200/80 dark:border-slate-800 text-center shrink-0">
          <span className="text-[10px] text-slate-400 font-medium">
            Pudding Assessment Platform
          </span>
        </div>
      </aside>
    </>
  );
};
