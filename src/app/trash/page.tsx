'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, BookOpen, ClipboardList, Loader2, RotateCcw, Trash2 } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { dataService } from '@/lib/supabase/dataService';
import { PageSkeleton } from '@/components/LoadingState';
import type { TrashItem, TrashKind } from '@/types/database';

type Filter = 'all' | TrashKind;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * ถังขยะ: classrooms and work the teacher deleted (on the web or in LINE),
 * kept 7 days. Each can be restored or deleted for good; the server deletes
 * expired ones (and their files) by itself.
 */
export default function TrashPage() {
  const { tr, language } = useLanguage();
  const th = language === 'th';
  const [items, setItems] = useState<TrashItem[] | null>(null);
  /** When the list was loaded (days left are counted from it). */
  const [loadedAt, setLoadedAt] = useState(0);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [busy, setBusy] = useState<{ id: string; action: 'restore' | 'delete' } | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string; href?: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await dataService.getTrash());
      setLoadedAt(Date.now());
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
      setItems([]);
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- first load
    load();
  }, [load]);

  const shown = useMemo(() => (items || []).filter((i) => filter === 'all' || i.kind === filter), [items, filter]);
  const count = (kind: TrashKind) => (items || []).filter((i) => i.kind === kind).length;

  const restore = async (item: TrashItem) => {
    setBusy({ id: item.id, action: 'restore' });
    setNotice(null);
    try {
      const result = await dataService.restoreTrashItem(item.id);
      setItems((list) => (list || []).filter((i) => i.id !== item.id));
      setNotice({
        tone: 'ok',
        text: tr(`กู้คืน "${item.title}" แล้ว`, `Restored "${item.title}"`),
        href: result.classroomId ? `/classrooms/${result.classroomId}` : undefined,
      });
    } catch (err) {
      setNotice({ tone: 'error', text: err instanceof Error ? err.message : tr('กู้คืนไม่สำเร็จ', 'Could not restore') });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (item: TrashItem) => {
    if (!confirm(tr(`ลบ "${item.title}" ถาวร?\nกู้คืนไม่ได้อีก`, `Delete "${item.title}" forever?\nThis cannot be undone.`))) return;
    setBusy({ id: item.id, action: 'delete' });
    setNotice(null);
    try {
      await dataService.deleteTrashItem(item.id);
      setItems((list) => (list || []).filter((i) => i.id !== item.id));
      setNotice({ tone: 'ok', text: tr('ลบถาวรแล้ว', 'Deleted forever') });
    } catch (err) {
      setNotice({ tone: 'error', text: err instanceof Error ? err.message : tr('ลบไม่สำเร็จ', 'Could not delete') });
    } finally {
      setBusy(null);
    }
  };

  const daysLeft = (item: TrashItem) => Math.max(0, Math.ceil((new Date(item.expires_at).getTime() - loadedAt) / DAY_MS));
  const dateText = (iso: string) =>
    new Date(iso).toLocaleDateString(th ? 'th-TH' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  if (items === null) return <PageSkeleton variant="list" />;

  const FILTERS: Array<{ id: Filter; label: string; n: number }> = [
    { id: 'all', label: tr('ทั้งหมด', 'All'), n: items.length },
    { id: 'assignment', label: tr('งาน', 'Work'), n: count('assignment') },
    { id: 'classroom', label: tr('ห้องเรียน', 'Classrooms'), n: count('classroom') },
  ];

  return (
    <div className="max-w-3xl mx-auto space-y-5 pb-10">
      <div className="space-y-1">
        <Link href="/dashboard" className="inline-flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
          <ArrowLeft className="w-3.5 h-3.5" /> {tr('กลับหน้าหลัก', 'Back to dashboard')}
        </Link>
        <h1 className="text-2xl font-black text-slate-900 dark:text-white flex items-center gap-2">
          <Trash2 className="w-6 h-6 text-rose-500" /> {tr('ถังขยะ', 'Trash')}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">{tr('ลบถาวรอัตโนมัติเมื่อครบ 7 วัน', 'Deleted forever after 7 days')}</p>
      </div>

      <div className="flex gap-1.5 overflow-x-auto">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            aria-pressed={filter === f.id}
            className={`h-9 px-3.5 rounded-full text-xs font-bold whitespace-nowrap cursor-pointer transition-colors ${
              filter === f.id
                ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
            }`}
          >
            {f.label} <span className="tabular-nums opacity-70">{f.n}</span>
          </button>
        ))}
      </div>

      {notice && (
        <p
          role="status"
          className={`px-4 py-3 rounded-2xl text-sm font-semibold flex flex-wrap items-center gap-x-3 gap-y-1 ${
            notice.tone === 'ok' ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'
          }`}
        >
          {notice.text}
          {notice.href && (
            <Link href={notice.href} className="underline font-bold">
              {tr('ไปที่ห้องเรียน', 'Open classroom')}
            </Link>
          )}
        </p>
      )}

      {error ? (
        <p className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/30 text-sm text-rose-700 dark:text-rose-300">{error}</p>
      ) : shown.length === 0 ? (
        <div className="py-16 text-center space-y-2 rounded-3xl border border-dashed border-slate-300 dark:border-slate-700">
          <Trash2 className="w-8 h-8 mx-auto text-slate-300 dark:text-slate-600" />
          <p className="text-sm text-slate-400">{tr('ถังขยะว่าง', 'Trash is empty')}</p>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {shown.map((item) => {
            const isRoom = item.kind === 'classroom';
            const Icon = isRoom ? BookOpen : ClipboardList;
            const left = daysLeft(item);
            const detail = isRoom
              ? tr(`${item.counts.students} นักเรียน · ${item.counts.assignments} งาน`, `${item.counts.students} students · ${item.counts.assignments} works`)
              : tr(`${item.counts.questions} ข้อ · ส่งแล้ว ${item.counts.submissions}`, `${item.counts.questions} questions · ${item.counts.submissions} handed in`);
            const isBusy = busy?.id === item.id;
            return (
              <li key={item.id} className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${isRoom ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400' : 'bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-400'}`}>
                    <Icon className="w-5 h-5" />
                  </span>
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-sm font-black text-slate-900 dark:text-white truncate">{item.title || tr('(ไม่มีชื่อ)', '(untitled)')}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                      {isRoom ? tr('ห้องเรียน', 'Classroom') : tr('งาน', 'Work')}
                      {item.subtitle && ` · ${item.subtitle}`} · {detail}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      {tr('ลบเมื่อ', 'Deleted')} {dateText(item.deleted_at)} ·{' '}
                      <span className={left <= 1 ? 'text-rose-600 dark:text-rose-400 font-bold' : ''}>
                        {left === 0 ? tr('ลบถาวรเร็ว ๆ นี้', 'Deleting soon') : tr(`เหลือ ${left} วัน`, `${left} day${left === 1 ? '' : 's'} left`)}
                      </span>
                    </p>
                  </div>
                </div>
                <div className="flex gap-2 shrink-0 sm:justify-end">
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => restore(item)}
                    className="flex-1 sm:flex-none h-10 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    {isBusy && busy?.action === 'restore' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                    {tr('กู้คืน', 'Restore')}
                  </button>
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => remove(item)}
                    className="flex-1 sm:flex-none h-10 px-4 rounded-xl border border-rose-200 dark:border-rose-900 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-xs font-black inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    {isBusy && busy?.action === 'delete' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    {tr('ลบถาวร', 'Delete forever')}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
