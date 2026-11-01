'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createZip, type ZipEntry } from '@/lib/storage/zip';
import { useLanguage } from '@/lib/i18n/LanguageContext';

/**
 * Admin panel for files in R2: back them up as a ZIP (downloaded straight from
 * storage in the browser), track which are backed up, and delete them to free
 * space. Downloading marks files as backed up; the flag can also be set by hand.
 */

interface AdminFile {
  key: string;
  url: string;
  purpose: 'submission' | 'sample';
  status: 'uploading' | 'draft' | 'attached' | 'orphan' | 'deleted';
  size_bytes: number | null;
  content_type: string | null;
  original_filename: string | null;
  created_at: string;
  backed_up_at: string | null;
  deleted_at: string | null;
  assignment_title: string | null;
  classroom_title: string | null;
  owner_name: string | null;
  owner_number: string | null;
}

type StatusFilter = 'stored' | 'attached' | 'draft' | 'orphan' | 'deleted' | 'all';
type BackupFilter = 'all' | 'no' | 'yes';

const PAGE = 200;
/** Above this a single ZIP gets heavy for the browser (and nears the ZIP 4GB limit). */
const ZIP_WARN_BYTES = 1.5 * 1024 * 1024 * 1024;

const STATUS_LABEL: Record<AdminFile['status'], [string, string]> = {
  uploading: ['กำลังอัปโหลด', 'Uploading'],
  draft: ['ร่าง (ยังไม่ส่ง)', 'Draft (not handed in)'],
  attached: ['ใช้งานอยู่', 'In use'],
  orphan: ['ไม่มีที่ใช้', 'Unused'],
  deleted: ['ลบแล้ว', 'Deleted'],
};
const STATUS_TONE: Record<AdminFile['status'], string> = {
  uploading: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  draft: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  attached: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  orphan: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300',
  deleted: 'bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-500',
};

const formatBytes = (bytes: number) =>
  bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
const formatDate = (iso: string | null, lang: 'th' | 'en' = 'th') =>
  iso ? new Date(iso).toLocaleString(lang === 'en' ? 'en-GB' : 'th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '';
const safePart = (value: string | null | undefined, fallback: string) => (value || fallback).replace(/[\\/:*?"<>|\n\r]+/g, '_').trim().slice(0, 80) || fallback;
const csvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;

async function postAction(body: Record<string, unknown>) {
  const res = await fetch('/api/admin/storage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'Action failed');
  return json;
}

/** The file's bytes: straight from public storage, else through the admin API (when storage blocks the browser). */
async function fetchFileBytes(file: AdminFile): Promise<Uint8Array> {
  for (const source of [file.url, `/api/admin/storage?key=${encodeURIComponent(file.key)}`]) {
    try {
      const res = await fetch(source, { cache: 'no-store' });
      if (res.ok) return new Uint8Array(await res.arrayBuffer());
    } catch {
      // try the next source
    }
  }
  throw new Error(`Cannot download ${file.key}`);
}

export function AdminStorage() {
  const [files, setFiles] = useState<AdminFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('stored');
  const [backupFilter, setBackupFilter] = useState<BackupFilter>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(PAGE);
  const { tr, language } = useLanguage();

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/admin/storage', { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Failed to load files');
      setFiles(json.files);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load files');
      setFiles([]);
    }
  }, []);

  useEffect(() => {
    // Fetching on mount; the state updates happen after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const stored = (files || []).filter((f) => f.status !== 'deleted');
    const sum = (list: AdminFile[]) => list.reduce((total, f) => total + Number(f.size_bytes || 0), 0);
    const backedUp = stored.filter((f) => f.backed_up_at);
    const notBackedUp = stored.filter((f) => !f.backed_up_at);
    const filesLabel = tr('ไฟล์', 'files');
    return [
      { label: tr('อยู่ใน R2', 'In R2'), value: `${stored.length} ${filesLabel}`, sub: formatBytes(sum(stored)) },
      { label: tr('สำรองแล้ว', 'Backed up'), value: `${backedUp.length} ${filesLabel}`, sub: formatBytes(sum(backedUp)), tone: 'emerald' },
      { label: tr('ยังไม่สำรอง', 'Not backed up'), value: `${notBackedUp.length} ${filesLabel}`, sub: formatBytes(sum(notBackedUp)), tone: 'amber' },
      { label: tr('ไม่มีที่ใช้ / ร่าง', 'Unused / drafts'), value: `${stored.filter((f) => f.status === 'orphan' || f.status === 'draft' || f.status === 'uploading').length} ${filesLabel}`, sub: tr('ลบได้โดยไม่กระทบงาน', 'Safe to delete'), tone: 'rose' },
    ];
  }, [files, tr]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (files || []).filter((f) => {
      if (statusFilter === 'stored' ? f.status === 'deleted' : statusFilter === 'draft' ? !['draft', 'uploading'].includes(f.status) : statusFilter !== 'all' && f.status !== statusFilter) return false;
      if (backupFilter === 'yes' && !f.backed_up_at) return false;
      if (backupFilter === 'no' && f.backed_up_at) return false;
      if (!q) return true;
      return [f.original_filename, f.key, f.assignment_title, f.classroom_title, f.owner_name, f.owner_number].some((v) => v?.toLowerCase().includes(q));
    });
  }, [files, statusFilter, backupFilter, search]);

  const selectedFiles = useMemo(() => (files || []).filter((f) => selected.has(f.key)), [files, selected]);
  const selectedBytes = selectedFiles.reduce((total, f) => total + Number(f.size_bytes || 0), 0);
  const allFilteredSelected = filtered.length > 0 && filtered.every((f) => selected.has(f.key));

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const run = async (label: string, task: () => Promise<string | void>) => {
    setBusy(label);
    setNotice(null);
    try {
      const message = await task();
      if (message) setNotice(message);
    } catch (err) {
      setNotice(`❌ ${err instanceof Error ? err.message : tr('เกิดข้อผิดพลาด', 'Something went wrong')}`);
    } finally {
      setBusy(null);
    }
  };

  const markBackedUp = async (keys: string[], backedUp: boolean) => {
    const { backed_up_at } = await postAction({ action: 'mark', keys, backedUp });
    const set = new Set(keys);
    setFiles((prev) => (prev || []).map((f) => (set.has(f.key) ? { ...f, backed_up_at } : f)));
  };

  const downloadZip = () =>
    run('download', async () => {
      const targets = selectedFiles.filter((f) => f.status !== 'deleted');
      if (!targets.length) return tr('ยังไม่ได้เลือกไฟล์ที่อยู่ใน R2', 'No files in R2 selected');
      if (selectedBytes > ZIP_WARN_BYTES && !confirm(tr(`ไฟล์ที่เลือกรวม ${formatBytes(selectedBytes)} อาจใหญ่เกินไปสำหรับเบราว์เซอร์ แนะนำให้แบ่งดาวน์โหลดทีละชุด\n\nดาวน์โหลดต่อหรือไม่?`, `The selection is ${formatBytes(selectedBytes)}, which may be too large for the browser. Downloading in smaller batches is recommended.\n\nContinue?`))) return;
      const entries: ZipEntry[] = [];
      const done: string[] = [];
      const failed: string[] = [];
      const manifest = [['zip_path', 'r2_key', 'classroom', 'assignment', 'student', 'student_number', 'status', 'uploaded_at', 'size_bytes'].map(csvCell).join(',')];
      const usedNames = new Set<string>();
      for (const [i, f] of targets.entries()) {
        setBusy(`download ${i + 1}/${targets.length}`);
        try {
          const data = await fetchFileBytes(f);
          const folder = f.purpose === 'sample'
            ? `${safePart(f.classroom_title, tr('ไม่ทราบห้อง', 'unknown_class'))}/${safePart(f.assignment_title, f.key.split('/')[1] || tr('งาน', 'assignment'))}/${tr('_ไฟล์ตัวอย่างของครู', '_teacher_sample')}`
            : `${safePart(f.classroom_title, tr('ไม่ทราบห้อง', 'unknown_class'))}/${safePart(f.assignment_title, f.key.split('/')[1] || tr('งาน', 'assignment'))}/${safePart([f.owner_number, f.owner_name].filter(Boolean).join('_'), f.key.split('/')[2] || tr('นักเรียน', 'student'))}`;
          let name = `${folder}/${safePart(f.original_filename, f.key.split('/').pop() || 'file')}`;
          for (let n = 2; usedNames.has(name); n++) name = name.replace(/(\.[^./]+)?$/, `-${n}$1`);
          usedNames.add(name);
          entries.push({ name, data, modified: new Date(f.created_at) });
          manifest.push([name, f.key, f.classroom_title, f.assignment_title, f.owner_name, f.owner_number, f.status, f.created_at, f.size_bytes].map(csvCell).join(','));
          done.push(f.key);
        } catch {
          failed.push(f.original_filename || f.key);
        }
      }
      if (!entries.length) throw new Error(tr('ดาวน์โหลดไฟล์ไม่สำเร็จเลย', 'No file could be downloaded'));
      // UTF-8 BOM so Excel shows Thai names correctly.
      entries.push({ name: 'manifest.csv', data: new TextEncoder().encode('﻿' + manifest.join('\n')) });
      const blob = createZip(entries);
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `pudding-files-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.zip`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
      await markBackedUp(done, true);
      return tr(
        `✅ ดาวน์โหลด ${done.length} ไฟล์ (${formatBytes(blob.size)}) และทำเครื่องหมายว่าสำรองแล้ว${failed.length ? ` — ดาวน์โหลดไม่สำเร็จ ${failed.length} ไฟล์: ${failed.slice(0, 5).join(', ')}` : ''}`,
        `✅ Downloaded ${done.length} files (${formatBytes(blob.size)}) and marked them backed up${failed.length ? ` — ${failed.length} failed: ${failed.slice(0, 5).join(', ')}` : ''}`
      );
    });

  const deleteSelected = () =>
    run('delete', async () => {
      const targets = selectedFiles.filter((f) => f.status !== 'deleted');
      if (!targets.length) return tr('ยังไม่ได้เลือกไฟล์ที่อยู่ใน R2', 'No files in R2 selected');
      const notBackedUp = targets.filter((f) => !f.backed_up_at).length;
      const inUse = targets.filter((f) => f.status === 'attached').length;
      const warning = [
        notBackedUp ? tr(`⚠️ ${notBackedUp} ไฟล์ยังไม่ได้สำรอง — ลบแล้วกู้คืนไม่ได้`, `⚠️ ${notBackedUp} files are not backed up — they cannot be recovered`) : '',
        inUse ? tr(`⚠️ ${inUse} ไฟล์เป็นงานที่นักเรียนส่ง/ไฟล์ตัวอย่างที่ใช้อยู่ ครูจะเปิดดูไม่ได้อีก`, `⚠️ ${inUse} files are handed-in work or sample files in use; teachers will no longer open them`) : '',
      ].filter(Boolean).join('\n');
      if (!confirm(tr(`ลบ ${targets.length} ไฟล์ (${formatBytes(selectedBytes)}) ออกจาก R2?\n${warning}`, `Delete ${targets.length} files (${formatBytes(selectedBytes)}) from R2?\n${warning}`))) return;
      if (notBackedUp && !confirm(tr(`ยืนยันอีกครั้ง: ลบไฟล์ที่ยังไม่สำรอง ${notBackedUp} ไฟล์?`, `Confirm again: delete ${notBackedUp} files that are not backed up?`))) return;
      const { removed } = await postAction({ action: 'delete', keys: targets.map((f) => f.key) });
      setSelected(new Set());
      await load();
      return tr(`🗑️ ลบออกจาก R2 แล้ว ${removed} ไฟล์`, `🗑️ Deleted ${removed} files from R2`);
    });

  const buttonClass = 'px-3 py-1.5 rounded-lg border text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer';

  return (
    <section id="storage" className="space-y-3 scroll-mt-28 p-5 rounded-3xl border border-sky-200 dark:border-sky-900/60 bg-white dark:bg-slate-900">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-black flex items-center gap-2"><span className="p-1.5 rounded-lg bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300">🗄️</span> {tr('ไฟล์ใน R2 (สำรองและลบ)', 'Files in R2 (back up & delete)')}</h2>
          <p className="text-xs text-slate-500">
            {tr('เลือกไฟล์แล้วกด "ดาวน์โหลด ZIP" เพื่อสำรอง (ระบบจะทำเครื่องหมายว่าสำรองแล้วให้อัตโนมัติ) จากนั้นลบออกเพื่อคืนพื้นที่', 'Select files and press "Download ZIP" to back them up (they are marked backed up automatically), then delete them to free space')}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            disabled={!!busy}
            onClick={() => run('sync', async () => {
              const r = await postAction({ action: 'sync' });
              await load();
              return tr(
                `🔄 ใน bucket ${r.objects} ไฟล์ • เพิ่มไฟล์เก่าที่ยังไม่อยู่ในรายการ ${r.added} • ไม่พบใน bucket ${r.missing} • ไม่มีที่ใช้ ${r.orphaned}`,
                `🔄 ${r.objects} files in the bucket • added older untracked files ${r.added} • missing from bucket ${r.missing} • unused ${r.orphaned}`
              );
            })}
            className={`${buttonClass} border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900`}
          >
            {tr('ซิงก์กับ bucket', 'Sync with bucket')}
          </button>
          <button
            type="button"
            disabled={!!busy}
            onClick={() => run('sweep', async () => {
              const r = await postAction({ action: 'sweep' });
              await load();
              return tr(`🧹 ลบไฟล์ร่างที่ไม่ได้ส่งเกิน 3 วันแล้ว ${r.removed} ไฟล์`, `🧹 Removed ${r.removed} draft uploads older than 3 days`);
            })}
            className={`${buttonClass} border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900`}
          >
            {tr('ล้างไฟล์ร่างที่หมดอายุ', 'Remove expired drafts')}
          </button>
        </div>
      </div>

      {error && <p className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 text-xs font-semibold">{error}</p>}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className={`p-3 rounded-2xl border bg-white dark:bg-slate-900 ${
              stat.tone === 'emerald' ? 'border-emerald-200 dark:border-emerald-900' : stat.tone === 'amber' ? 'border-amber-200 dark:border-amber-900' : stat.tone === 'rose' ? 'border-rose-200 dark:border-rose-900' : 'border-slate-200 dark:border-slate-800'
            }`}
          >
            <p className="text-[11px] font-bold text-slate-500">{stat.label}</p>
            <p className="text-lg font-black tabular-nums">{files ? stat.value : '—'}</p>
            <p className="text-[11px] text-slate-500 tabular-nums">{files ? stat.sub : ''}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value as StatusFilter); setLimit(PAGE); }} className="px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
          <option value="stored">{tr('อยู่ใน R2 ทั้งหมด', 'All in R2')}</option>
          <option value="attached">{tr('ใช้งานอยู่', 'In use')}</option>
          <option value="draft">{tr('ร่าง (ยังไม่ส่ง)', 'Draft (not handed in)')}</option>
          <option value="orphan">{tr('ไม่มีที่ใช้', 'Unused')}</option>
          <option value="deleted">{tr('ลบแล้ว', 'Deleted')}</option>
          <option value="all">{tr('ทั้งหมด (รวมที่ลบแล้ว)', 'All (incl. deleted)')}</option>
        </select>
        <select value={backupFilter} onChange={(e) => { setBackupFilter(e.target.value as BackupFilter); setLimit(PAGE); }} className="px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
          <option value="all">{tr('สำรอง: ทั้งหมด', 'Backup: all')}</option>
          <option value="no">{tr('ยังไม่สำรอง', 'Not backed up')}</option>
          <option value="yes">{tr('สำรองแล้ว', 'Backed up')}</option>
        </select>
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setLimit(PAGE); }}
          placeholder={tr('ค้นหา ชื่อไฟล์ / งาน / ห้อง / นักเรียน', 'Search file / assignment / class / student')}
          className="flex-1 min-w-48 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="font-bold text-slate-600 dark:text-slate-300 mr-1">
          {tr('เลือก', 'Selected')} {selected.size} {tr('ไฟล์', 'files')} • {formatBytes(selectedBytes)}
        </span>
        <button type="button" disabled={!!busy || !selected.size} onClick={downloadZip} className={`${buttonClass} border-sky-200 dark:border-sky-900 bg-sky-50 dark:bg-sky-950/40 text-sky-800 dark:text-sky-300`}>
          {tr('ดาวน์โหลด ZIP', 'Download ZIP')}
        </button>
        <button type="button" disabled={!!busy || !selected.size} onClick={() => run('mark', async () => { await markBackedUp([...selected], true); return tr('✅ ทำเครื่องหมายว่าสำรองแล้ว', '✅ Marked as backed up'); })} className={`${buttonClass} border-emerald-200 dark:border-emerald-900 bg-white dark:bg-slate-900`}>
          {tr('ตั้งว่าสำรองแล้ว', 'Mark backed up')}
        </button>
        <button type="button" disabled={!!busy || !selected.size} onClick={() => run('unmark', async () => { await markBackedUp([...selected], false); return tr('ตั้งว่ายังไม่สำรองแล้ว', 'Marked as not backed up'); })} className={`${buttonClass} border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900`}>
          {tr('ตั้งว่ายังไม่สำรอง', 'Mark not backed up')}
        </button>
        <button type="button" disabled={!!busy || !selected.size} onClick={deleteSelected} className={`${buttonClass} border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300`}>
          {tr('ลบออกจาก R2', 'Delete from R2')}
        </button>
        {selected.size > 0 && (
          <button type="button" disabled={!!busy} onClick={() => setSelected(new Set())} className="px-2 py-1.5 text-slate-500 hover:underline cursor-pointer">
            {tr('ล้างที่เลือก', 'Clear selection')}
          </button>
        )}
        {busy && <span className="text-slate-500">{tr('กำลังทำงาน…', 'Working…')} {busy.startsWith('download ') ? busy.slice(9) : ''}</span>}
      </div>
      {notice && <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">{notice}</p>}

      <div className="overflow-auto max-h-[70vh] rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-slate-100 dark:bg-slate-800 text-left text-slate-500">
            <tr>
              <th className="px-3 py-2">
                <input
                  type="checkbox"
                  aria-label={tr('เลือกทั้งหมดที่กรองไว้', 'Select all filtered')}
                  checked={allFilteredSelected}
                  onChange={() =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      for (const f of filtered) {
                        if (allFilteredSelected) next.delete(f.key);
                        else next.add(f.key);
                      }
                      return next;
                    })
                  }
                />
              </th>
              {[tr('ไฟล์', 'File'), tr('ห้อง / งาน', 'Class / assignment'), tr('ผู้อัปโหลด', 'Uploader'), tr('ขนาด', 'Size'), tr('อัปโหลดเมื่อ', 'Uploaded'), tr('สถานะ', 'Status'), tr('สำรอง', 'Backup')].map((h) => (
                <th key={h} className="px-3 py-2 font-bold whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {files === null ? (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-500">{tr('กำลังโหลด…', 'Loading…')}</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-500">{tr('ไม่มีไฟล์ตามเงื่อนไขนี้', 'No files match')}</td></tr>
            ) : (
              filtered.slice(0, limit).map((f) => (
                <tr key={f.key} className={`border-t border-slate-100 dark:border-slate-800 align-top ${selected.has(f.key) ? 'bg-sky-50/60 dark:bg-sky-950/20' : ''}`}>
                  <td className="px-3 py-2">
                    <input type="checkbox" aria-label={`${tr('เลือก', 'Select')} ${f.original_filename || f.key}`} checked={selected.has(f.key)} onChange={() => toggle(f.key)} />
                  </td>
                  <td className="px-3 py-2 max-w-xs">
                    {f.status === 'deleted' ? (
                      <span className="block truncate text-slate-400 line-through" title={f.key}>{f.original_filename || f.key}</span>
                    ) : (
                      <a href={f.url} target="_blank" rel="noreferrer" className="block truncate font-semibold text-amber-700 dark:text-amber-400 hover:underline" title={f.key}>
                        {f.original_filename || f.key}
                      </a>
                    )}
                    <span className="text-[10px] text-slate-400">{f.purpose === 'sample' ? tr('ไฟล์ตัวอย่างของครู', 'Teacher sample') : tr('งานนักเรียน', 'Student work')}</span>
                  </td>
                  <td className="px-3 py-2 max-w-56">
                    <span className="block truncate">{f.classroom_title || '—'}</span>
                    <span className="block truncate text-slate-500">{f.assignment_title || '—'}</span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {f.owner_name || '—'} <span className="text-slate-400">{f.owner_number || ''}</span>
                  </td>
                  <td className="px-3 py-2 tabular-nums whitespace-nowrap">{f.size_bytes ? formatBytes(Number(f.size_bytes)) : '—'}</td>
                  <td className="px-3 py-2 tabular-nums whitespace-nowrap">{formatDate(f.created_at, language)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_TONE[f.status]}`}>{tr(...STATUS_LABEL[f.status])}</span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <button
                      type="button"
                      disabled={!!busy}
                      onClick={() => run('mark', () => markBackedUp([f.key], !f.backed_up_at))}
                      title={tr('คลิกเพื่อเปลี่ยนสถานะการสำรอง', 'Click to toggle backup status')}
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold cursor-pointer disabled:cursor-not-allowed ${
                        f.backed_up_at ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                      }`}
                    >
                      {f.backed_up_at ? `✓ ${formatDate(f.backed_up_at, language)}` : tr('ยังไม่สำรอง', 'Not backed up')}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {filtered.length > limit && (
        <button type="button" onClick={() => setLimit((n) => n + PAGE)} className="text-xs font-bold text-amber-700 dark:text-amber-400 hover:underline cursor-pointer">
          {tr('แสดงเพิ่ม', 'Show more')} ({filtered.length - limit} {tr('ไฟล์', 'files')})
        </button>
      )}
    </section>
  );
}
