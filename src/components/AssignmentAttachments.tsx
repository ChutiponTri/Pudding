'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, FileText, Link2, Loader2, X } from 'lucide-react';
import type { AssignmentAttachment } from '@/types/database';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { googleAppName, isPdfUrl } from '@/lib/utils/referenceWork';

/**
 * Teacher attachments on homework, shown the same way everywhere (creator,
 * classroom cards, grading, student app): a link looks like a link, a Drive
 * link carries the Drive mark, an image shows its picture and a PDF looks like
 * a file. Images and PDFs open in a preview; links open in a new tab.
 */

export function GoogleDriveMark({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 87.3 78" className={className} aria-hidden="true">
      <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da" />
      <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" fill="#00ac47" />
      <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335" />
      <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d" />
      <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc" />
      <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00" />
    </svg>
  );
}

const opensPreview = (a: AssignmentAttachment) => a.kind === 'image' || (a.kind === 'file' && (isPdfUrl(a.url) || a.url.startsWith('blob:')));

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function useKindLabel() {
  const { tr } = useLanguage();
  return (a: AssignmentAttachment) =>
    a.kind === 'image' ? tr('รูปภาพ', 'Image') : a.kind === 'file' ? 'PDF' : a.kind === 'drive' ? googleAppName(a.url) : `${tr('ลิงก์', 'Link')} · ${hostOf(a.url)}`;
}

/** The square on the left of a card: the picture itself, a PDF sheet, the Drive mark or a link glyph. */
function Thumb({ attachment, size }: { attachment: AssignmentAttachment; size: 'sm' | 'md' }) {
  const box = size === 'md' ? 'w-20 self-stretch min-h-16' : 'w-9 h-9 rounded-lg';
  const icon = size === 'md' ? 'w-6 h-6' : 'w-4 h-4';
  if (attachment.kind === 'image') {
    return (
      <span className={`${box} shrink-0 overflow-hidden bg-slate-100 dark:bg-slate-800`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={attachment.url} alt="" loading="lazy" draggable={false} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
      </span>
    );
  }
  if (attachment.kind === 'file') {
    return (
      <span className={`${box} shrink-0 flex flex-col items-center justify-center gap-0.5 bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400`}>
        <FileText className={icon} />
        {size === 'md' && <span className="text-[9px] font-black tracking-wider">PDF</span>}
      </span>
    );
  }
  if (attachment.kind === 'drive') {
    return (
      <span className={`${box} shrink-0 flex items-center justify-center bg-white dark:bg-slate-800`}>
        <GoogleDriveMark className={icon} />
      </span>
    );
  }
  return (
    <span className={`${box} shrink-0 flex items-center justify-center bg-sky-50 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400`}>
      <Link2 className={icon} />
    </span>
  );
}

function PreviewDialog({ attachment, onClose }: { attachment: AssignmentAttachment; onClose: () => void }) {
  const { tr } = useLanguage();
  const kindLabel = useKindLabel();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Portal to <body>: an animated ancestor would otherwise confine this fixed overlay.
  return createPortal(
    <div className="fixed inset-0 z-70 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 animate-in fade-in" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={attachment.name}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-4xl max-h-full flex flex-col rounded-3xl bg-white dark:bg-slate-900 shadow-2xl overflow-hidden"
      >
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-slate-100 dark:border-slate-800">
          <Thumb attachment={attachment} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{attachment.name}</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{kindLabel(attachment)}</p>
          </div>
          <a
            href={attachment.url}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{tr('เปิดในแท็บใหม่', 'Open in new tab')}</span>
          </a>
          <button
            type="button"
            onClick={onClose}
            aria-label={tr('ปิด', 'Close')}
            className="shrink-0 w-8 h-8 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-slate-500 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 min-h-0 bg-slate-100 dark:bg-slate-950 flex items-center justify-center">
          {attachment.kind === 'image' ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={attachment.url} alt={attachment.name} className="max-w-full max-h-[calc(100dvh-9rem)] object-contain" />
          ) : (
            <iframe src={attachment.url} title={attachment.name} className="w-full h-[calc(100dvh-9rem)] bg-white" />
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

/** One attachment. `onRemove` adds a remove button (the creator); `busy` shows it is still uploading. */
export function AttachmentCard({
  attachment,
  size = 'md',
  onRemove,
  busy = false,
  note,
}: {
  attachment: AssignmentAttachment;
  size?: 'sm' | 'md';
  onRemove?: () => void;
  busy?: boolean;
  /** Replaces the kind label, e.g. "uploads when you save". */
  note?: string;
}) {
  const { tr } = useLanguage();
  const kindLabel = useKindLabel();
  const [previewing, setPreviewing] = useState(false);
  const preview = opensPreview(attachment);
  // Cards around this may be draggable or clickable; a tap here is only about the attachment.
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  const md = size === 'md';
  const frame = `group relative flex items-center min-w-0 w-full overflow-hidden text-left border bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 hover:border-sky-400 dark:hover:border-sky-600 hover:shadow-sm transition-all ${
    md ? 'rounded-2xl' : 'rounded-xl gap-2 p-1 pr-2'
  }`;
  const body = (
    <>
      <Thumb attachment={attachment} size={size} />
      <span className={`min-w-0 flex-1 ${md ? 'px-3 py-2.5' : ''} ${onRemove ? 'pr-9' : ''}`}>
        <span className={`block font-bold text-slate-800 dark:text-slate-100 truncate ${md ? 'text-xs sm:text-sm' : 'text-[11px]'}`}>{attachment.name}</span>
        <span className={`flex items-center gap-1 text-slate-500 dark:text-slate-400 truncate ${md ? 'text-[11px] mt-0.5' : 'text-[10px]'}`}>
          {busy && <Loader2 className="w-3 h-3 animate-spin shrink-0" />}
          <span className="truncate">{note || kindLabel(attachment)}</span>
        </span>
      </span>
    </>
  );

  return (
    <div className="relative min-w-0">
      {preview ? (
        <button
          type="button"
          draggable={false}
          onMouseDown={stop}
          onClick={(e) => {
            stop(e);
            setPreviewing(true);
          }}
          title={attachment.name}
          className={`${frame} cursor-zoom-in`}
        >
          {body}
        </button>
      ) : (
        <a
          href={attachment.url}
          target="_blank"
          rel="noopener noreferrer"
          draggable={false}
          onMouseDown={stop}
          onClick={stop}
          title={attachment.url}
          className={frame}
        >
          {body}
        </a>
      )}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={tr('นำออก', 'Remove')}
          title={tr('นำออก', 'Remove')}
          className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 cursor-pointer transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      )}
      {previewing && <PreviewDialog attachment={attachment} onClose={() => setPreviewing(false)} />}
    </div>
  );
}

/** A list of attachments: `md` cards in a grid (assignment pages), `sm` compact rows (cards, headers). */
export function AttachmentList({
  attachments,
  size = 'md',
  className = '',
}: {
  attachments: AssignmentAttachment[];
  size?: 'sm' | 'md';
  className?: string;
}) {
  if (!attachments.length) return null;
  const grid = size === 'md' ? 'grid grid-cols-1 sm:grid-cols-2 gap-2.5' : 'grid grid-cols-1 gap-1.5';
  return (
    <div className={`${grid} ${className}`}>
      {attachments.map((a) => (
        <AttachmentCard key={a.url} attachment={a} size={size} />
      ))}
    </div>
  );
}
