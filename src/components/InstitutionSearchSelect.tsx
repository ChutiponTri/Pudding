'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Search, Building, Check, ChevronDown, School, GraduationCap } from 'lucide-react';
import { searchInstitutions, EducationalInstitution } from '@/lib/data/thaiInstitutions';

interface Props {
  value: string;
  onChange: (institutionName: string) => void;
  placeholder?: string;
  extraInstitutions?: string[];
  disabled?: boolean;
  required?: boolean;
}

export const InstitutionSearchSelect: React.FC<Props> = ({
  value,
  onChange,
  placeholder = 'เลือกโรงเรียน / สถาบันการศึกษา...',
  extraInstitutions = [],
  disabled = false,
  required = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const results = searchInstitutions(searchQuery, extraInstitutions);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (inst: EducationalInstitution) => {
    onChange(inst.name);
    setIsOpen(false);
    setSearchQuery('');
  };

  return (
    <div ref={containerRef} className="relative w-full text-left">
      {/* Trigger Button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen((prev) => !prev)}
        className={`w-full px-3.5 py-2.5 rounded-xl border flex items-center justify-between gap-2 text-xs transition-all cursor-pointer ${
          value
            ? 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white font-medium'
            : 'bg-slate-50 dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 text-slate-400'
        } ${isOpen ? 'ring-2 ring-amber-500 border-amber-500' : ''}`}
      >
        <div className="flex items-center gap-2 truncate">
          <School className="w-4 h-4 text-amber-500 shrink-0" />
          <span className="truncate">{value || placeholder}</span>
        </div>
        <ChevronDown className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute z-50 left-0 right-0 mt-1.5 p-2 bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 space-y-2 max-h-72 flex flex-col animate-in fade-in zoom-in-95 duration-100">
          {/* Search Box */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              autoFocus
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="พิมพ์ชื่อโรงเรียน / วิทยาลัย / มหาวิทยาลัย..."
              className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-hidden focus:ring-1 focus:ring-amber-500 font-medium"
            />
          </div>

          {/* List Options */}
          <div className="overflow-y-auto space-y-1 pr-1 flex-1">
            {results.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-400">
                ไม่พบชื่อสถาบันที่ตรงกับคำค้นหา
              </div>
            ) : (
              results.map((inst) => {
                const isSelected = value === inst.name;
                return (
                  <button
                    key={inst.id}
                    type="button"
                    onClick={() => handleSelect(inst)}
                    className={`w-full px-2.5 py-2 rounded-xl text-left text-xs flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 font-bold'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/80 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      {inst.type === 'university' ? (
                        <GraduationCap className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                      ) : (
                        <Building className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      )}
                      <div className="truncate">
                        <div className="truncate font-medium">{inst.name}</div>
                        <span className="text-[10px] text-slate-400">{inst.province}</span>
                      </div>
                    </div>
                    {isSelected && <Check className="w-3.5 h-3.5 text-amber-600 shrink-0" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
