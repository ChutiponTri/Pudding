import { ExternalLink, FileText, Image as ImageIcon, Paperclip } from 'lucide-react';
import type { Assignment } from '@/types/database';
import { isImageUrl, isPdfUrl, referenceWorkUrl } from '@/lib/utils/referenceWork';

/** Compact row showing an assignment's attached reference link or file, for teacher pages. */
export function ReferenceWorkLink({ assignment, className = '' }: { assignment: Assignment; className?: string }) {
  const url = referenceWorkUrl(assignment.sample_work_url);
  const title = assignment.sample_work_title?.trim();
  if (!url && !title) return null;
  const Icon = !url ? Paperclip : isPdfUrl(url) ? FileText : isImageUrl(url) ? ImageIcon : ExternalLink;
  const kind = !url ? '' : isPdfUrl(url) ? 'PDF' : isImageUrl(url) ? 'รูปภาพ' : 'ลิงก์';
  const label = title || assignment.sample_work_url || 'ไฟล์แนบ';

  const body = (
    <>
      <Icon className="w-3.5 h-3.5 shrink-0" />
      <span className="truncate">📎 {label}</span>
      {kind && <span className="shrink-0 text-[10px] font-semibold opacity-70">({kind})</span>}
    </>
  );
  const base = `flex items-center gap-1.5 min-w-0 px-2.5 py-1.5 rounded-xl text-[11px] font-bold border ${className}`;
  return url ? (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      draggable={false}
      onClick={(e) => e.stopPropagation()}
      title={assignment.sample_work_description || url}
      className={`${base} bg-sky-50 dark:bg-sky-950/40 border-sky-200 dark:border-sky-900 text-sky-700 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-950`}
    >
      {body}
    </a>
  ) : (
    <span title={assignment.sample_work_description} className={`${base} bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500`}>
      {body}
    </span>
  );
}
