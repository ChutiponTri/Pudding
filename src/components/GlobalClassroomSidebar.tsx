'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  X,
  BookOpen,
  Plus,
  LayoutDashboard,
  GraduationCap,
  Sparkles,
  Users,
} from 'lucide-react';
import { dataService } from '@/lib/supabase/dataService';
import { Classroom } from '@/types/database';
import { useSidebar } from '@/components/SidebarContext';

export const GlobalClassroomSidebar: React.FC = () => {
  const pathname = usePathname();
  const { isOpen, setIsOpen, closeSidebar } = useSidebar();
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [loading, setLoading] = useState(false);

  // Do not render on LIFF student portal
  if (pathname.startsWith('/liff')) {
    return null;
  }

  // Load teacher's classrooms
  const loadClassrooms = async () => {
    try {
      setLoading(true);
      const data = await dataService.getClassrooms();
      setClassrooms(data);
    } catch (err) {
      console.warn('Failed to load classrooms for sidebar:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && classrooms.length === 0) {
      loadClassrooms();
    }
  }, [isOpen]);

  // Sort classrooms from newest to oldest
  const sortedClassrooms = useMemo(() => {
    return [...classrooms].sort((a, b) => {
      const timeA = new Date(a.created_at || 0).getTime();
      const timeB = new Date(b.created_at || 0).getTime();
      return timeB - timeA;
    });
  }, [classrooms]);

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
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      closeSidebar();
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Mobile Drawer Backdrop (ONLY visible on mobile < 768px; iPad and desktop do not blur/cover the page) */}
      <div
        className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs z-40 md:hidden animate-in fade-in duration-200"
        onClick={closeSidebar}
        aria-hidden="true"
      />

      {/* Sidebar Container: Fixed on left (w-80) */}
      <aside className="fixed inset-y-0 left-0 w-80 max-w-full bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 shadow-2xl md:shadow-lg flex flex-col z-50 animate-in slide-in-from-left duration-250 ease-out select-none overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/70 dark:bg-slate-850/60 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-amber-600 via-amber-500 to-yellow-400 flex items-center justify-center font-bold text-sm shadow-xs shrink-0">
              🍮
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-black text-slate-900 dark:text-white truncate">ห้องเรียนและรายวิชา</h2>
              <p className="text-[10px] text-slate-500 font-medium truncate">รายวิชาทั้งหมด</p>
            </div>
          </div>
          <button
            onClick={closeSidebar}
            className="p-1.5 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors cursor-pointer shrink-0"
            aria-label="Close sidebar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Quick Actions Shortcuts */}
        <div className="p-3 border-b border-slate-200 dark:border-slate-800 grid grid-cols-2 gap-2 bg-white dark:bg-slate-900 shrink-0">
          <Link
            href="/dashboard"
            onClick={handleItemClick}
            className="p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700/80 text-slate-700 dark:text-slate-200 text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer truncate"
          >
            <LayoutDashboard className="w-3.5 h-3.5 text-amber-600 shrink-0" />
            <span className="truncate">แดชบอร์ด</span>
          </Link>
          <Link
            href="/assignments/new"
            onClick={handleItemClick}
            className="p-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-black flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-xs truncate"
          >
            <Plus className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">สร้างงาน/สอบ</span>
          </Link>
        </div>

        {/* Total Count Subtitle Banner */}
        <div className="px-4 py-2 bg-slate-50/50 dark:bg-slate-800/40 border-b border-slate-100 dark:border-slate-800/60 flex items-center justify-between text-[11px] text-slate-500 shrink-0">
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
          {loading ? (
            <div className="p-8 text-center text-xs text-slate-400 space-y-2">
              <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto" />
              <p>กำลังโหลดห้องเรียน...</p>
            </div>
          ) : sortedClassrooms.length === 0 ? (
            <div className="p-8 text-center bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-200/80 dark:border-slate-800 text-xs text-slate-400 space-y-2">
              <GraduationCap className="w-8 h-8 text-slate-300 mx-auto" />
              <p>ยังไม่มีห้องเรียนในระบบ</p>
            </div>
          ) : (
            groupedCourses.map((group) => (
              <div key={group.label} className="space-y-1.5 min-w-0">
                <div className="px-2 py-1 flex items-center justify-between gap-1 min-w-0">
                  <p className="text-xs font-black text-slate-800 dark:text-slate-200 truncate flex items-center gap-1.5 min-w-0">
                    <BookOpen className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    <span className="truncate">{group.label}</span>
                  </p>
                  <span className="text-[10px] text-slate-400 font-mono shrink-0">
                    ({group.items.length})
                  </span>
                </div>

                <div className="space-y-1 pl-1 min-w-0">
                  {group.items.map((cls) => {
                    const isActive = pathname.startsWith(`/classrooms/${cls.id}`);
                    const studentCount = cls.student_count || cls.students?.length || 0;

                    return (
                      <Link
                        key={cls.id}
                        href={`/classrooms/${cls.id}`}
                        onClick={handleItemClick}
                        className={`flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer min-w-0 ${
                          isActive
                            ? 'bg-amber-100 dark:bg-amber-950/70 text-amber-950 dark:text-amber-200 font-black border border-amber-300 dark:border-amber-700 shadow-xs'
                            : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isActive ? 'bg-amber-500' : 'bg-slate-300 dark:bg-slate-600'}`} />
                          <span className="truncate">{cls.name}</span>
                        </div>
                        <span className="text-[10px] text-slate-400 font-normal shrink-0 ml-2 flex items-center gap-0.5">
                          <Users className="w-2.5 h-2.5" />
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
        <div className="p-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-850/40 text-center shrink-0">
          <span className="text-[10px] text-slate-400 font-medium">
            Pudding Assessment Platform
          </span>
        </div>
      </aside>
    </>
  );
};
