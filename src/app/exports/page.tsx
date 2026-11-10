'use client';

import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowLeft,
  CalendarCheck,
  Check,
  ClipboardList,
  Download,
  FileSpreadsheet,
  FileText,
  ListChecks,
  Loader2,
  TableProperties,
  UserX,
  Users,
} from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useTeacherDashboardData } from '@/lib/hooks/useTeacherDashboardData';
import { useSemesterParam } from '@/lib/hooks/useSemesterParam';
import { SemesterSelect } from '@/components/SemesterSelect';
import { dataService } from '@/lib/supabase/dataService';
import { classroomTitle } from '@/lib/utils/classroomLabel';
import { filterClassroomsBySemester, semesterOptions } from '@/lib/utils/semesterFilter';
import { buildReports, type ReportId } from '@/lib/export/teacherReports';
import { createXlsx, sheetToCsv, XLSX_MIME } from '@/lib/export/xlsx';
import { createZip, downloadBlob } from '@/lib/storage/zip';
import { PageSkeleton } from '@/components/LoadingState';

type Format = 'xlsx' | 'csv';

/**
 * Export centre for teachers: pick classrooms (by term) and reports, then
 * download one Excel workbook (a sheet per report / classroom) or CSV files in
 * a ZIP. Data is fetched fresh when downloading, never from the page cache.
 * The quick CSV buttons inside each classroom stay as they are.
 */
function ExportsContent() {
  const { tr, language } = useLanguage();
  const { data, error: loadError } = useTeacherDashboardData();
  const { semesterKey, setSemesterKey, currentPeriod } = useSemesterParam();
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [reports, setReports] = useState<Set<ReportId>>(new Set(['gradebook', 'attendance']));
  const [format, setFormat] = useState<Format>('xlsx');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const courses = useMemo(() => data?.courses || [], [data]);
  const classrooms = useMemo(() => data?.classrooms || [], [data]);
  const options = useMemo(() => semesterOptions(courses, classrooms, currentPeriod.yearCE), [courses, classrooms, currentPeriod.yearCE]);
  const inTerm = useMemo(
    () => filterClassroomsBySemester(classrooms, courses, semesterKey, currentPeriod.yearCE),
    [classrooms, courses, semesterKey, currentPeriod.yearCE]
  );
  // Default: every classroom of the term; a choice only keeps classrooms still in the term.
  const selected = useMemo(
    () => (picked ? inTerm.filter((c) => picked.has(c.id)) : inTerm),
    [picked, inTerm]
  );
  const selectedIds = new Set(selected.map((c) => c.id));

  const REPORTS: Array<{ id: ReportId; icon: typeof FileText; title: string; detail: string; tone: string }> = [
    { id: 'gradebook', icon: TableProperties, title: tr('สมุดคะแนน', 'Grade book'), detail: tr('นักเรียน × งาน/ข้อสอบ คะแนนรวม ร้อยละ (ชีตละห้อง + ชีตสรุป)', 'Students × work, totals and percent (a sheet per classroom + summary)'), tone: 'emerald' },
    { id: 'attendance', icon: CalendarCheck, title: tr('สรุปการเข้าเรียน', 'Attendance'), detail: tr('นักเรียน × คาบ มา/สาย/ขาด/ลา และ % มาเรียน', 'Students × periods with present/late/absent/excused and %'), tone: 'sky' },
    { id: 'submissions', icon: ClipboardList, title: tr('รายละเอียดการส่งงาน', 'Submission log'), detail: tr('1 แถวต่อนักเรียนต่องาน: สถานะ เวลาส่ง คะแนน การแก้ไข ส่งแทนเพื่อน', 'One row per student per work: status, time, score, edits, borrowed phone'), tone: 'violet' },
    { id: 'question_scores', icon: ListChecks, title: tr('คะแนนรายข้อ', 'Scores per question'), detail: tr('คะแนนและความเห็นครูของทุกข้อ (ใช้วิเคราะห์ข้อสอบ)', 'Score and comment for every question (item analysis)'), tone: 'amber' },
    { id: 'missing', icon: UserX, title: tr('งานค้างส่ง', 'Missing work'), detail: tr('นักเรียนที่ยังไม่ส่งงานที่เลยกำหนดแล้ว (ใช้ติดตามงาน)', 'Students who have not handed in past-due work'), tone: 'rose' },
    { id: 'roster', icon: Users, title: tr('รายชื่อนักเรียน', 'Roster'), detail: tr('รหัส ชื่อ สถานศึกษา อีเมล สถานะในห้อง', 'ID, name, school, email, status'), tone: 'slate' },
  ];
  const toneOn: Record<string, string> = {
    emerald: 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 ring-1 ring-emerald-500/40',
    sky: 'border-sky-500 bg-sky-50 dark:bg-sky-950/40 ring-1 ring-sky-500/40',
    violet: 'border-violet-500 bg-violet-50 dark:bg-violet-950/40 ring-1 ring-violet-500/40',
    amber: 'border-amber-500 bg-amber-50 dark:bg-amber-950/40 ring-1 ring-amber-500/40',
    rose: 'border-rose-500 bg-rose-50 dark:bg-rose-950/40 ring-1 ring-rose-500/40',
    slate: 'border-slate-500 bg-slate-100 dark:bg-slate-800 ring-1 ring-slate-500/40',
  };
  const toneIcon: Record<string, string> = {
    emerald: 'bg-emerald-500', sky: 'bg-sky-500', violet: 'bg-violet-500', amber: 'bg-amber-500', rose: 'bg-rose-500', slate: 'bg-slate-500',
  };

  const toggleClassroom = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };
  const toggleReport = (id: ReportId) => {
    const next = new Set(reports);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setReports(next);
  };

  const download = async () => {
    if (!selected.length || !reports.size) return;
    setBusy(true);
    setMessage(null);
    try {
      const fresh = await dataService.getTeacherExportData(selected.map((c) => c.id));
      const sheets = buildReports(fresh, [...reports], language);
      const stamp = new Date().toISOString().slice(0, 10);
      const base = `pudding-${tr('ข้อมูล', 'export')}-${stamp}`;
      if (format === 'xlsx') {
        downloadBlob(`${base}.xlsx`, createXlsx(sheets), XLSX_MIME);
      } else {
        const enc = new TextEncoder();
        const used = new Set<string>();
        const files = sheets.map((sheet) => {
          let name = sheet.name.replace(/[\\/:*?"<>|]+/g, '_');
          for (let n = 2; used.has(name); n++) name = `${sheet.name}_${n}`;
          used.add(name);
          return { name: `${base}/${name}.csv`, data: enc.encode(sheetToCsv(sheet)) };
        });
        downloadBlob(`${base}.zip`, createZip(files));
      }
      setMessage({ tone: 'ok', text: tr(`ดาวน์โหลดแล้ว: ${sheets.length} ชีต จาก ${fresh.classrooms.length} ห้อง`, `Downloaded ${sheets.length} sheets from ${fresh.classrooms.length} classrooms`) });
    } catch (err) {
      console.error(err);
      setMessage({ tone: 'error', text: err instanceof Error && err.message ? err.message : tr('ส่งออกไม่สำเร็จ ลองใหม่อีกครั้ง', 'Export failed, please try again') });
    } finally {
      setBusy(false);
    }
  };

  // What the file will contain, for the summary panel.
  const sheetPreview = [
    ...(reports.has('gradebook') ? [tr('สรุปคะแนน', 'Grade summary'), ...selected.map((c) => `${tr('คะแนน', 'Grades')} · ${classroomTitle(c)}`)] : []),
    ...(reports.has('attendance') ? [tr('สรุปเช็กชื่อ', 'Attendance summary'), ...selected.map((c) => `${tr('เช็กชื่อ', 'Attendance')} · ${classroomTitle(c)}`)] : []),
    ...REPORTS.filter((r) => ['submissions', 'question_scores', 'missing', 'roster'].includes(r.id) && reports.has(r.id)).map((r) => r.title),
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <Link href="/dashboard" className="inline-flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
            <ArrowLeft className="w-3.5 h-3.5" /> {tr('กลับหน้าหลัก', 'Back to dashboard')}
          </Link>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white flex items-center gap-2">
            <span className="p-2 rounded-2xl bg-linear-to-br from-emerald-500 to-teal-500 text-white shadow-lg shadow-emerald-500/25">
              <FileSpreadsheet className="w-5 h-5" />
            </span>
            {tr('ส่งออกข้อมูล', 'Export data')}
          </h1>
        </div>
        <SemesterSelect value={semesterKey} onChange={(key) => { setSemesterKey(key); setPicked(null); }} options={options} currentPeriod={currentPeriod} />
      </div>

      {loadError && (
        <p className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4" /> {tr('โหลดรายชื่อห้องเรียนไม่สำเร็จ', 'Could not load your classrooms')}
        </p>
      )}

      <div className="grid lg:grid-cols-[1fr_300px] gap-6 items-start">
        <div className="space-y-6">
          {/* 1. Classrooms */}
          <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-black text-slate-900 dark:text-white">1 · {tr('ห้องเรียน', 'Classrooms')}</h2>
              {inTerm.length > 1 && (
                <div className="flex gap-2 text-xs font-bold">
                  <button type="button" onClick={() => setPicked(null)} className="text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer">{tr('เลือกทั้งหมด', 'Select all')}</button>
                  <button type="button" onClick={() => setPicked(new Set())} className="text-slate-500 hover:underline cursor-pointer">{tr('ล้าง', 'Clear')}</button>
                </div>
              )}
            </div>
            {!data ? (
              <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="w-4 h-4 animate-spin" /> {tr('กำลังโหลด…', 'Loading…')}</div>
            ) : inTerm.length === 0 ? (
              <p className="text-sm text-slate-500">{tr('ไม่มีห้องเรียนในภาคเรียนนี้', 'No classrooms in this term')}</p>
            ) : (
              <div className="grid sm:grid-cols-2 gap-2">
                {inTerm.map((c) => {
                  const on = selectedIds.has(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleClassroom(c.id)}
                      aria-pressed={on}
                      className={`flex items-center gap-3 p-3 rounded-2xl border text-left cursor-pointer transition-colors ${
                        on ? 'border-emerald-500 bg-emerald-50/70 dark:bg-emerald-950/30' : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                      }`}
                    >
                      <span className={`w-5 h-5 shrink-0 rounded-md border flex items-center justify-center ${on ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-300 dark:border-slate-600'}`}>
                        {on && <Check className="w-3.5 h-3.5" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-bold text-slate-900 dark:text-white truncate">{classroomTitle(c)}</span>
                        <span className="block text-[11px] text-slate-500">{tr(`นักเรียน ${c.students?.length ?? c.student_count ?? 0} คน`, `${c.students?.length ?? c.student_count ?? 0} students`)}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {/* 2. Reports */}
          <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-3">
            <h2 className="text-sm font-black text-slate-900 dark:text-white">2 · {tr('รายงาน', 'Reports')}</h2>
            <div className="grid sm:grid-cols-2 gap-2">
              {REPORTS.map(({ id, icon: Icon, title, detail, tone }) => {
                const on = reports.has(id);
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => toggleReport(id)}
                    aria-pressed={on}
                    className={`flex items-start gap-3 p-3.5 rounded-2xl border text-left cursor-pointer transition-all ${on ? toneOn[tone] : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'}`}
                  >
                    <span className={`p-2 rounded-xl text-white shrink-0 ${on ? toneIcon[tone] : 'bg-slate-300 dark:bg-slate-700'}`}>
                      <Icon className="w-4 h-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-bold text-slate-900 dark:text-white">{title}</span>
                      <span className="block text-[11px] text-slate-500 dark:text-slate-400 leading-snug">{detail}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        </div>

        {/* 3. Summary + download */}
        <aside className="lg:sticky lg:top-20 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-4">
          <h2 className="text-sm font-black text-slate-900 dark:text-white">3 · {tr('ไฟล์', 'File')}</h2>
          <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-bold">
            {(['xlsx', 'csv'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFormat(f)}
                className={`py-1.5 rounded-lg cursor-pointer ${format === f ? 'bg-white dark:bg-slate-900 shadow-sm text-slate-900 dark:text-white' : 'text-slate-500'}`}
              >
                {f === 'xlsx' ? 'Excel (.xlsx)' : 'CSV (.zip)'}
              </button>
            ))}
          </div>
          <div className="text-xs space-y-1">
            <p className="font-bold text-slate-500">
              {format === 'xlsx' ? tr(`${sheetPreview.length} ชีตในไฟล์เดียว`, `${sheetPreview.length} sheets in one file`) : tr(`${sheetPreview.length} ไฟล์ CSV`, `${sheetPreview.length} CSV files`)}
            </p>
            <ul className="max-h-48 overflow-y-auto space-y-0.5 text-slate-600 dark:text-slate-300">
              {sheetPreview.map((name, i) => (
                <li key={`${name}-${i}`} className="flex items-center gap-1.5 truncate"><FileText className="w-3 h-3 shrink-0 text-slate-400" />{name}</li>
              ))}
            </ul>
          </div>
          <button
            type="button"
            onClick={download}
            disabled={busy || !selected.length || !reports.size}
            className="w-full h-11 rounded-2xl bg-linear-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-white text-sm font-black flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/25 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {busy ? tr('กำลังเตรียมไฟล์…', 'Preparing…') : tr('ดาวน์โหลด', 'Download')}
          </button>
          {message && (
            <p className={`text-xs font-semibold ${message.tone === 'ok' ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600'}`}>{message.text}</p>
          )}
        </aside>
      </div>
    </div>
  );
}

export default function ExportsPage() {
  return (
    <Suspense fallback={<PageSkeleton variant="form" />}>
      <ExportsContent />
    </Suspense>
  );
}
