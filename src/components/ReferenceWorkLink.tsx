'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, FileText, Image as ImageIcon, Paperclip, X } from 'lucide-react';
import type { Assignment } from '@/types/database';
import { isImageUrl, isPdfUrl, referenceWorkUrl } from '@/lib/utils/referenceWork';

/**
 * An assignment's attached reference work on teacher pages. Images and PDFs
 * open in a popup (with "open in new tab" for the full file); other links open
 * directly. `preview` shows a small thumbnail instead of a one-line chip.
 */
export function ReferenceWorkLink({
  assignment,
  preview = false,
  className = '',
}: {
  assignment: Assignment;
  preview?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const url = referenceWorkUrl(assignment.sample_work_url);
  const title = assignment.sample_work_title?.trim();
  const isImage = !!url && isImageUrl(url);
  const isPdf = !!url && isPdfUrl(url);
  const opensPopup = isImage || isPdf;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!url && !title) return null;
  const Icon = !url ? Paperclip : isPdf ? FileText : isImage ? ImageIcon : ExternalLink;
  const kind = !url ? '' : isPdf ? 'PDF' : isImage ? 'รูปภาพ' : 'ลิงก์';
  const label = title || assignment.sample_work_url || 'ไฟล์แนบ';
  // Cards around this may be draggable or clickable; a tap here is only about the attachment.
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  const popup =
    open && opensPopup
      ? createPortal(
          // Portal to <body>: an animated ancestor would otherwise confine this fixed overlay.
          <div
            className="fixed inset-0 z-70 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 animate-in fade-in"
            onClick={() => setOpen(false)}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label={label}
              onClick={stop}
              className="w-full max-w-4xl max-h-full flex flex-col rounded-3xl bg-white dark:bg-slate-900 shadow-2xl overflow-hidden"
            >
              <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 dark:border-slate-800">
                <Icon className="w-4 h-4 text-sky-600 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-black text-slate-900 dark:text-white truncate">{label}</p>
                  {assignment.sample_work_description && (
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{assignment.sample_work_description}</p>
                  )}
                </div>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>เปิดในแท็บใหม่</span>
                </a>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="ปิด"
                  className="shrink-0 w-8 h-8 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-slate-500 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 min-h-0 bg-slate-100 dark:bg-slate-950 flex items-center justify-center">
                {isImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={url} alt={label} className="max-w-full max-h-[calc(100dvh-9rem)] object-contain" />
                ) : (
                  <iframe src={url} title={label} className="w-full h-[calc(100dvh-9rem)] bg-white" />
                )}
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  if (preview && opensPopup) {
    return (
      <>
        <button
          type="button"
          draggable={false}
          onClick={(e) => {
            stop(e);
            setOpen(true);
          }}
          onMouseDown={stop}
          title={`ดูตัวอย่าง: ${label}`}
          className={`group flex items-center gap-3 w-full min-w-0 p-2 rounded-2xl border border-sky-200 dark:border-sky-900 bg-sky-50/70 dark:bg-sky-950/30 hover:border-sky-400 text-left cursor-zoom-in transition-colors ${className}`}
        >
          <span className="relative w-16 h-12 shrink-0 rounded-xl overflow-hidden bg-white dark:bg-slate-800 ring-1 ring-sky-100 dark:ring-sky-900 flex items-center justify-center">
            {isImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url} alt="" loading="lazy" draggable={false} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
            ) : (
              <span className="flex flex-col items-center text-rose-600">
                <FileText className="w-5 h-5" />
                <span className="text-[9px] font-black">PDF</span>
              </span>
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] font-bold text-sky-800 dark:text-sky-300 truncate">📎 {label}</span>
            <span className="block text-[10px] text-slate-500 dark:text-slate-400">แตะเพื่อดูตัวอย่าง ({kind})</span>
          </span>
        </button>
        {popup}
      </>
    );
  }

  const body = (
    <>
      <Icon className="w-3.5 h-3.5 shrink-0" />
      <span className="truncate">📎 {label}</span>
      {kind && <span className="shrink-0 text-[10px] font-semibold opacity-70">({kind})</span>}
    </>
  );
  const base = `flex items-center gap-1.5 min-w-0 px-2.5 py-1.5 rounded-xl text-[11px] font-bold border ${className}`;
  const linkTone = 'bg-sky-50 dark:bg-sky-950/40 border-sky-200 dark:border-sky-900 text-sky-700 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-950';

  if (opensPopup) {
    return (
      <>
        <button
          type="button"
          draggable={false}
          onClick={(e) => {
            stop(e);
            setOpen(true);
          }}
          title={assignment.sample_work_description || label}
          className={`${base} ${linkTone} cursor-zoom-in`}
        >
          {body}
        </button>
        {popup}
      </>
    );
  }
  return url ? (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      draggable={false}
      onClick={stop}
      title={assignment.sample_work_description || url}
      className={`${base} ${linkTone}`}
    >
      {body}
    </a>
  ) : (
    <span title={assignment.sample_work_description} className={`${base} bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500`}>
      {body}
    </span>
  );
}
