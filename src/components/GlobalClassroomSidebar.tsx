'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  X,
  BookOpen,
  Plus,
  LayoutDashboard,
  Layers,
  GraduationCap,
  Sparkles,
  ChevronRight,
  Filter,
} from 'lucide-react';
import { dataService } from '@/lib/supabase/dataService';
import { Classroom } from '@/types/database';

export const GlobalClassroomSidebar: React.FC = () => {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedSemester, setSelectedSemester] = useState<string>('all');

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
    const handleToggle = () => {
      setIsOpen((prev) => !prev);
    };
    window.addEventListener('toggle-classroom-sidebar', handleToggle);
    return () => window.removeEventListener('toggle-classroom-sidebar', handleToggle);
  }, []);

  useEffect(() => {
    if (isOpen && classrooms.length === 0) {
      loadClassrooms();
    }
  }, [isOpen]);

  // Close sidebar on page change
  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  // Extract available semesters
  const availableSemesters = useMemo(() => {
    const set = new Set<string>();
    classrooms.forEach((c) => {
      if (c.academic_year && c.academic_year.trim()) {
        set.add(c.academic_year.trim());
      }
    });
    return Array.from(set).sort().reverse();
  }, [classrooms]);

  // Filter classrooms by semester
  const filteredClassrooms = useMemo(() => {
    if (selectedSemester === 'all') return classrooms;
    return classrooms.filter((c) => (c.academic_year || 'ปัจจุบัน') === selectedSemester);
  }, [classrooms, selectedSemester]);

  // Group by Course / Subject
  const coursesMap = useMemo(() => {
    const map = new Map<string, { label: string; items: Classroom[] }>();
    for (const cls of filteredClassrooms) {
      const key = cls.course_name || cls.subject_code || 'รายวิชาทั่วไป';
      if (!map.has(key)) {
        map.set(key, { label: key, items: [] });
      }
      map.get(key)!.items.push(cls);
    }
    return map;
  }, [filteredClassrooms]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs transition-opacity animate-in fade-in duration-200"
        onClick={() => setIsOpen(false)}
        aria-hidden="true"
      />

      {/* Slide-over Drawer Panel */}
      <div className="fixed inset-y-0 left-0 max-w-full flex">
        <aside className="w-80 sm:w-88 max-w-sm bg-white dark:bg-slate-900 shadow-2xl border-r border-slate-200 dark:border-slate-800 flex flex-col h-full animate-in slide-in-from-left duration-250 ease-out">
          {/* Header */}
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/70 dark:bg-slate-850/60">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-600 flex items-center justify-center font-bold text-sm">
                🍮
              </div>
              <div>
                <h2 className="text-sm font-black text-slate-900 dark:text-white">ห้องเรียนและรายวิชา</h2>
                <p className="text-[10px] text-slate-500 font-medium">สลับไปห้องเรียนหรือวิชาอื่นได้อย่างรวดเร็ว</p>
              </div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="p-1.5 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors cursor-pointer"
              aria-label="Close sidebar"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Quick Actions Shortcuts */}
          <div className="p-3 border-b border-slate-200 dark:border-slate-800 grid grid-cols-2 gap-2 bg-white dark:bg-slate-900">
            <Link
              href="/dashboard"
              onClick={() => setIsOpen(false)}
              className="p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700/80 text-slate-700 dark:text-slate-200 text-xs font-bold flex items-center gap-2 transition-all cursor-pointer"
            >
              <LayoutDashboard className="w-3.5 h-3.5 text-amber-600" />
              <span>แดชบอร์ด</span>
            </Link>
            <Link
              href="/assignments/new"
              onClick={() => setIsOpen(false)}
              className="p-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-black flex items-center gap-1.5 transition-all cursor-pointer shadow-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>สร้างงาน/สอบ</span>
            </Link>
          </div>

          {/* Semester / Academic Year Filter */}
          {availableSemesters.length > 0 && (
            <div className="p-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-850/40 space-y-1.5">
              <div className="flex items-center justify-between px-1">
                <span className="text-[10px] font-black uppercase text-slate-400 flex items-center gap-1">
                  <Filter className="w-3 h-3 text-amber-500" />
                  <span>กรองตามภาคเรียน / ปีการศึกษา</span>
                </span>
                {selectedSemester !== 'all' && (
                  <button
                    onClick={() => setSelectedSemester('all')}
                    className="text-[10px] text-amber-600 font-bold hover:underline cursor-pointer"
                  >
                    รีเซ็ต
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                <button
                  type="button"
                  onClick={() => setSelectedSemester('all')}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold whitespace-nowrap transition-all cursor-pointer ${
                    selectedSemester === 'all'
                      ? 'bg-amber-500 text-slate-950 font-black shadow-xs'
                      : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 border border-slate-200 dark:border-slate-700'
                  }`}
                >
                  ทั้งหมด
                </button>
                {availableSemesters.map((sem) => (
                  <button
                    key={sem}
                    type="button"
                    onClick={() => setSelectedSemester(sem)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold whitespace-nowrap transition-all cursor-pointer ${
                      selectedSemester === sem
                        ? 'bg-amber-500 text-slate-950 font-black shadow-xs'
                        : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 border border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    {sem}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Grouped Classrooms List */}
          <div className="flex-1 overflow-y-auto p-3 space-y-4">
            {loading ? (
              <div className="p-8 text-center text-xs text-slate-400 space-y-2">
                <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto" />
                <p>กำลังโหลดห้องเรียน...</p>
              </div>
            ) : filteredClassrooms.length === 0 ? (
              <div className="p-8 text-center bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-200/80 dark:border-slate-800 text-xs text-slate-400 space-y-2">
                <GraduationCap className="w-8 h-8 text-slate-300 mx-auto" />
                <p>ไม่พบห้องเรียนในภาคเรียนนี้</p>
              </div>
            ) : (
              Array.from(coursesMap.entries()).map(([courseTitle, group]) => (
                <div key={courseTitle} className="space-y-1">
                  <div className="px-2 py-1 flex items-center justify-between">
                    <p className="text-xs font-black text-slate-800 dark:text-slate-200 truncate flex items-center gap-1.5">
                      <BookOpen className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      <span className="truncate">{courseTitle}</span>
                    </p>
                    <span className="text-[10px] text-slate-400 font-mono shrink-0">
                      ({group.items.length})
                    </span>
                  </div>
                  <div className="space-y-1 pl-2">
                    {group.items.map((cls) => {
                      const isActive = pathname.startsWith(`/classrooms/${cls.id}`);
                      return (
                        <Link
                          key={cls.id}
                          href={`/classrooms/${cls.id}`}
                          onClick={() => setIsOpen(false)}
                          className={`flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                            isActive
                              ? 'bg-amber-100 dark:bg-amber-950/70 text-amber-900 dark:text-amber-200 font-black border border-amber-300 dark:border-amber-700'
                              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
                          }`}
                        >
                          <span className="truncate">{cls.name}</span>
                          <span className="text-[10px] text-slate-400 font-normal shrink-0 ml-1">
                            {cls.student_count || cls.students?.length || 0} คน
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
          <div className="p-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-850/40 text-center">
            <span className="text-[10px] text-slate-400 font-medium">
              Pudding Assessment Platform
            </span>
          </div>
        </aside>
      </div>
    </div>
  );
};
