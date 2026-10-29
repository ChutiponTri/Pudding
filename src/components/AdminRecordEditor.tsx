'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

/**
 * Edits one database row as an admin. Every column is shown; the key,
 * created_at and secret columns are read-only (secrets never reach the page).
 * Only changed columns are sent, typed after the value they had.
 */

type Kind = 'boolean' | 'number' | 'json' | 'text';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const kindOf = (value: unknown): Kind =>
  typeof value === 'boolean' ? 'boolean' : typeof value === 'number' ? 'number' : value !== null && typeof value === 'object' ? 'json' : 'text';

const toDraft = (value: unknown, kind: Kind) =>
  value === null || value === undefined ? '' : kind === 'json' ? JSON.stringify(value, null, 2) : String(value);

/** Deleting these takes rows below them with it. */
const CASCADE_WARNING: Record<string, string> = {
  classrooms: 'งาน คำตอบ การเช็คชื่อ และไฟล์ของห้องนี้จะถูกลบไปด้วย',
  assignments: 'คำถาม งานที่นักเรียนส่ง และไฟล์ของงานนี้จะถูกลบไปด้วย',
  courses: 'ห้องเรียนที่ผูกกับรายวิชานี้อาจได้รับผลกระทบ',
  users: 'ข้อมูลที่อ้างถึงผู้ใช้นี้ (งานที่ส่ง การเช็คชื่อ) อาจถูกลบหรือค้างอยู่',
  submissions: 'คำตอบและบันทึกการออกจากหน้าจอของงานนี้จะถูกลบไปด้วย',
};

export function AdminRecordEditor({
  table,
  id,
  record,
  readOnly,
  links,
}: {
  table: string;
  id: string;
  record: Row;
  readOnly: string[];
  /** column -> table its value points at */
  links: Record<string, string>;
}) {
  const router = useRouter();
  const columns = useMemo(() => Object.keys(record), [record]);
  const kinds = useMemo(() => Object.fromEntries(columns.map((c) => [c, kindOf(record[c])])) as Record<string, Kind>, [columns, record]);
  const initial = useMemo(
    () => Object.fromEntries(columns.map((c) => [c, { text: toDraft(record[c], kinds[c]), isNull: record[c] === null }])),
    [columns, kinds, record]
  );
  const [drafts, setDrafts] = useState(initial);
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const changed = columns.filter(
    (c) => !readOnly.includes(c) && (drafts[c].isNull !== initial[c].isNull || drafts[c].text !== initial[c].text)
  );
  const setDraft = (column: string, patch: Partial<{ text: string; isNull: boolean }>) =>
    setDrafts((prev) => ({ ...prev, [column]: { ...prev[column], ...patch } }));

  const save = async () => {
    const changes: Row = {};
    for (const column of changed) {
      const draft = drafts[column];
      if (draft.isNull) {
        changes[column] = null;
        continue;
      }
      const kind = kinds[column];
      if (kind === 'boolean') changes[column] = draft.text === 'true';
      else if (kind === 'number') {
        const value = Number(draft.text);
        if (draft.text.trim() === '' || !Number.isFinite(value)) return setMessage({ tone: 'error', text: `${column}: ต้องเป็นตัวเลข` });
        changes[column] = value;
      } else if (kind === 'json') {
        try {
          changes[column] = JSON.parse(draft.text);
        } catch {
          return setMessage({ tone: 'error', text: `${column}: JSON ไม่ถูกต้อง` });
        }
      } else changes[column] = draft.text;
    }
    setBusy('save');
    setMessage(null);
    try {
      const res = await fetch('/api/admin/records', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table, id, changes }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'บันทึกไม่สำเร็จ');
      // The database's own form of the values (e.g. timestamps), matching the refreshed record.
      const saved = (json.record || {}) as Row;
      setDrafts((prev) => ({
        ...prev,
        ...Object.fromEntries(Object.keys(saved).filter((c) => c in prev).map((c) => [c, { text: toDraft(saved[c], kinds[c]), isNull: saved[c] === null }])),
      }));
      setMessage({ tone: 'ok', text: `บันทึกแล้ว (${changed.length} คอลัมน์)` });
      router.refresh();
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ' });
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    const warning = CASCADE_WARNING[table] ? `\n\n⚠️ ${CASCADE_WARNING[table]}` : '';
    if (!confirm(`ลบ ${table} / ${id} ถาวร?${warning}\n\nย้อนกลับไม่ได้`)) return;
    setBusy('delete');
    setMessage(null);
    try {
      const res = await fetch('/api/admin/records', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table, id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'ลบไม่สำเร็จ');
      router.push(`/admin/${table}`);
      router.refresh();
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'ลบไม่สำเร็จ' });
      setBusy(null);
    }
  };

  const inputClass =
    'w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-mono disabled:opacity-50';

  return (
    <section className="space-y-4">
      <p className="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/40 ring-1 ring-amber-200 dark:ring-amber-900 text-xs text-amber-900 dark:text-amber-200">
        แก้ไขข้อมูลดิบในฐานข้อมูลโดยตรง ไม่ผ่านการตรวจสอบของระบบ — ตรวจค่าให้ถูกต้องก่อนบันทึก
      </p>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800">
        {columns.map((column) => {
          const kind = kinds[column];
          const draft = drafts[column];
          const locked = readOnly.includes(column);
          const isChanged = changed.includes(column);
          const long = kind === 'json' || draft.text.length > 80 || draft.text.includes('\n');
          return (
            <div key={column} className={`grid sm:grid-cols-[14rem_1fr] gap-1.5 sm:gap-4 px-4 py-3 ${isChanged ? 'bg-amber-50/70 dark:bg-amber-950/20' : ''}`}>
              <div className="min-w-0">
                <p className="font-mono text-xs font-bold break-all">{column}</p>
                <p className="text-[10px] text-slate-400">
                  {locked ? 'อ่านอย่างเดียว' : kind}
                  {links[column] && record[column] && (
                    <>
                      {' • '}
                      <Link href={`/admin/${links[column]}/${encodeURIComponent(String(record[column]))}`} className="text-sky-600 dark:text-sky-400 hover:underline">
                        เปิด {links[column]}
                      </Link>
                    </>
                  )}
                </p>
              </div>
              <div className="flex items-start gap-2 min-w-0">
                <div className="flex-1 min-w-0">
                  {kind === 'boolean' && !draft.isNull ? (
                    <select
                      disabled={locked}
                      value={draft.text}
                      onChange={(e) => setDraft(column, { text: e.target.value })}
                      className={inputClass}
                    >
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </select>
                  ) : long ? (
                    <textarea
                      disabled={locked || draft.isNull}
                      value={draft.isNull ? '' : draft.text}
                      placeholder={draft.isNull ? 'NULL' : ''}
                      onChange={(e) => setDraft(column, { text: e.target.value })}
                      rows={kind === 'json' ? Math.min(16, Math.max(3, draft.text.split('\n').length)) : 4}
                      className={inputClass}
                    />
                  ) : (
                    <input
                      disabled={locked || draft.isNull}
                      type={kind === 'number' ? 'number' : 'text'}
                      step="any"
                      value={draft.isNull ? '' : draft.text}
                      placeholder={draft.isNull ? 'NULL' : ''}
                      onChange={(e) => setDraft(column, { text: e.target.value })}
                      className={inputClass}
                    />
                  )}
                </div>
                {!locked && (
                  <label className="shrink-0 flex items-center gap-1 text-[10px] text-slate-500 pt-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={draft.isNull}
                      onChange={(e) =>
                        setDraft(column, {
                          isNull: e.target.checked,
                          // A boolean that was NULL needs a value to start from.
                          ...(kind === 'boolean' && !e.target.checked && !draft.text ? { text: 'false' } : {}),
                        })
                      }
                    />
                    NULL
                  </label>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="sticky bottom-0 py-3 bg-slate-50/95 dark:bg-slate-950/95 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={!changed.length || busy !== null}
          className="h-10 px-5 rounded-xl bg-amber-500 text-slate-950 text-sm font-bold disabled:opacity-40 cursor-pointer"
        >
          {busy === 'save' ? 'กำลังบันทึก…' : `บันทึก${changed.length ? ` (${changed.length})` : ''}`}
        </button>
        <button
          type="button"
          onClick={() => {
            setDrafts(initial);
            setMessage(null);
          }}
          disabled={!changed.length || busy !== null}
          className="h-10 px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-bold disabled:opacity-40 cursor-pointer"
        >
          ยกเลิกการแก้ไข
        </button>
        <button
          type="button"
          onClick={remove}
          disabled={busy !== null}
          className="ml-auto h-10 px-4 rounded-xl border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-sm font-bold hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-40 cursor-pointer"
        >
          {busy === 'delete' ? 'กำลังลบ…' : 'ลบแถวนี้'}
        </button>
        {message && (
          <p role="status" className={`w-full text-xs font-bold ${message.tone === 'ok' ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}`}>
            {message.text}
          </p>
        )}
      </div>
    </section>
  );
}
