'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
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
} from 'lucide-react';
import { dataService, CLASSROOMS_CHANGED_EVENT } from '@/lib/supabase/dataService';
import { Classroom } from '@/types/database';
import { useSidebar } from '@/components/SidebarContext';

/** Short "term/year" label, e.g. "เทอม 1/2568", so the same room in another year is told apart. */
function periodLabel(cls: Classroom): string {
  const term = cls.semester === 3 ? 'ซัมเมอร์' : cls.semester ? `เทอม ${cls.semester}` : '';
  const year = cls.year_ce ? String(cls.year_ce + 543) : cls.academic_year || '';
  return [term, year].filter(Boolean).join('/');
}

export const GlobalClassroomSidebar: React.FC = () => {
  const pathname = usePathname();
  const { isOpen, setIsOpen, closeSidebar } = useSidebar();
  // Tagged with the teacher it was fetched for, so a different session never sees it.
  const [list, setList] = useState<{ teacherId: string; items: Classroom[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const { user, isLoaded } = useUser();
  const teacherId = user?.id;

  // Bumped whenever the classroom list may have changed (create/edit/delete,
  // roster changes) so the next open, or the open sidebar, refetches.
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
  // same scope the dashboard uses. Fetch lazily on first open, then only when
  // the session or the classroom list changes.
  useEffect(() => {
    if (!isOpen || !isLoaded || !teacherId) return;
    const key = `${teacherId}:${listVersion}`;
    if (loadedKey.current === key) return;
    loadedKey.current = key;

    let cancelled = false;
    let settled = false;
    setLoading(true);
    dataService
      .getClassrooms(teacherId, { withRoster: false })
      .then((data) => {
        if (!cancelled) setList({ teacherId, items: data });
      })
      .catch((err) => {
        console.warn('Failed to load classrooms for sidebar:', err);
        // Allow a retry on the next open.
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
      // Closed or superseded mid-request: let the next run fetch again.
      if (loadedKey.current === key) loadedKey.current = null;
    };
  }, [isOpen, isLoaded, teacherId, listVersion]);

  // Sort classrooms from newest to oldest
  const sortedClassrooms = useMemo(() => {
    // Signed out or another teacher: show nothing rather than a previous teacher's list.
    const classrooms = teacherId && list?.teacherId === teacherId ? list.items : [];
    return [...classrooms].sort((a, b) => {
      const timeA = new Date(a.created_at || 0).getTime();
      const timeB = new Date(b.created_at || 0).getTime();
      return timeB - timeA;
    });
  }, [list, teacherId]);

  // Group classrooms by Course / Subject while maintaining newest-to-oldest order
  const groupedCourses = useMemo(() => {
    const map = new Map<string, { label: string; subjectCode?: string; items: Classroom[] }>();
    for (const cls of sortedClassrooms) {
      const key = cls.course_name || cls.subject_code || 'รายวิชาทั่วไป';
      if (!map.has(key)) {
        map.set(key, { label: key, subjectCode: cls.subject_code, items: [] });
      }
      map.get(key)!.items.push(cls);
    }
    return Array.from(map.values());
  }, [sortedClassrooms]);

  const handleItemClick = () => {
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      closeSidebar();
    }
  };

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
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-2xl bg-linear-to-tr from-amber-600 via-amber-500 to-yellow-400 flex items-center justify-center font-bold text-base shadow-md shadow-amber-500/25 shrink-0">
              🍮
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-black text-slate-900 dark:text-white truncate">ห้องเรียนและรายวิชา</h2>
              <p className="text-[10px] text-slate-500 font-medium truncate">รายวิชาทั้งหมด</p>
            </div>
          </div>
          <button
            onClick={closeSidebar}
            className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors cursor-pointer shrink-0"
            aria-label="Close sidebar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Quick Actions Shortcuts */}
        <div className="p-3 grid grid-cols-2 gap-2 shrink-0">
          <Link
            href="/dashboard"
            onClick={handleItemClick}
            className="px-3 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700/80 text-slate-700 dark:text-slate-200 text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer truncate"
          >
            <LayoutDashboard className="w-3.5 h-3.5 text-amber-600 shrink-0" />
            <span className="truncate">แดชบอร์ด</span>
          </Link>
          <Link
            href="/assignments/new"
            onClick={handleItemClick}
            className="px-3 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-sm shadow-amber-500/30 active:scale-[0.98] truncate"
          >
            <Plus className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">สร้างงาน/สอบ</span>
          </Link>
        </div>

        {/* Total Count Subtitle Banner */}
        <div className="mx-3 mb-1 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/50 flex items-center justify-between text-[11px] text-slate-500 shrink-0">
          <span className="font-bold flex items-center gap-1">
            <GraduationCap className="w-3.5 h-3.5 text-amber-500" />
            <span>ทั้งหมด {sortedClassrooms.length} ห้องเรียน</span>
          </span>
          <span className="text-[10px] text-slate-400 font-mono">
            {groupedCourses.length} รายวิชา
          </span>
        </div>

        {/* Classrooms List: Smooth Scroll with no horizontal overflow */}
        <div className="flex-1 overflow-y-auto p-3 space-y-4 overflow-x-hidden min-w-0">
          {loading && sortedClassrooms.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400 space-y-2">
              <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto" />
              <p>กำลังโหลดห้องเรียน...</p>
            </div>
          ) : sortedClassrooms.length === 0 ? (
            <div className="p-5 sm:p-8 text-center bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-200/80 dark:border-slate-800 text-xs text-slate-400 space-y-2">
              <GraduationCap className="w-8 h-8 text-slate-300 mx-auto" />
              <p>ยังไม่มีห้องเรียนในระบบ</p>
            </div>
          ) : (
            groupedCourses.map((group) => (
              <div key={group.label} className="space-y-1.5 min-w-0">
                <div className="px-2 py-1.5 flex items-center justify-between gap-2 min-w-0">
                  <p className="text-sm font-black text-slate-900 dark:text-white truncate flex items-center gap-2 min-w-0" title={group.label}>
                    <span className="w-7 h-7 rounded-lg bg-amber-100 dark:bg-amber-950/70 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                      <BookOpen className="w-4 h-4" />
                    </span>
                    <span className="truncate">{group.label}</span>
                  </p>
                  <span className="px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-[11px] font-bold text-slate-500 dark:text-slate-400 tabular-nums shrink-0">
                    {group.items.length}
                  </span>
                </div>

                <div className="space-y-1 pl-2 ml-3.5 border-l border-slate-200 dark:border-slate-800 min-w-0">
                  {group.items.map((cls) => {
                    const isActive = pathname.startsWith(`/classrooms/${cls.id}`);
                    const studentCount = cls.student_count || cls.students?.length || 0;

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
                            {periodLabel(cls) && (
                              <span className={`block text-[11px] font-semibold leading-tight ${isActive ? 'text-amber-700 dark:text-amber-400' : 'text-slate-400'}`}>
                                {periodLabel(cls)}
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
              </div>
            ))
          )}
        </div>

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
