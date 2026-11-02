import type { Assignment, AssignmentAttachment, AttachmentKind } from '@/types/database';

/**
 * Link to a teacher's reference work (sample_work_url): an http(s) link, or a
 * bare "www.…" a teacher typed without the scheme. Anything else is not linked.
 */
export function referenceWorkUrl(raw?: string | null): string {
  const url = (raw || '').trim();
  if (/^https?:\/\//i.test(url)) return url;
  return /^[\w-]+(\.[\w-]+)+(\/|$)/.test(url) ? `https://${url}` : '';
}

export const isImageUrl = (url: string) => /\.(png|jpe?g|webp|gif)($|\?)/i.test(url);
export const isPdfUrl = (url: string) => /\.pdf($|\?)/i.test(url);

/** Homework may carry this many attachments (links, Drive links, images, PDFs). */
export const MAX_ASSIGNMENT_ATTACHMENTS = 3;

const ATTACHMENT_KINDS: AttachmentKind[] = ['link', 'drive', 'image', 'file'];

/** Google Drive / Docs / Sheets / Slides / Forms links. */
export const isGoogleDriveUrl = (url: string) => {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'drive.google.com' || host === 'docs.google.com' || host === 'forms.gle';
  } catch {
    return false;
  }
};

/** What a link most likely is, for links saved before attachments had a kind. */
export function attachmentKindForUrl(url: string): AttachmentKind {
  if (isGoogleDriveUrl(url)) return 'drive';
  if (isImageUrl(url)) return 'image';
  if (isPdfUrl(url)) return 'file';
  return 'link';
}

/** A readable name for a link: host and path, without the scheme or "www.". */
export function linkDisplayName(url: string): string {
  try {
    const parsed = new URL(url);
    const path = decodeURIComponent(parsed.pathname).replace(/\/+$/, '');
    return `${parsed.hostname.replace(/^www\./, '')}${path}`.slice(0, 120) || url;
  } catch {
    return url;
  }
}

/** The file name inside an uploaded file's URL (keys end in <stamp>_<name>). */
export function fileNameFromUrl(url: string): string {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
    return last.replace(/^\d+(-[a-z0-9]+)?_/, '') || last;
  } catch {
    return url;
  }
}

/** Which Google app a Drive link opens, for the subtitle under it. */
export function googleAppName(url: string): string {
  try {
    const { hostname, pathname } = new URL(url);
    if (hostname === 'forms.gle' || pathname.startsWith('/forms')) return 'Google Forms';
    if (hostname === 'docs.google.com') {
      if (pathname.startsWith('/document')) return 'Google Docs';
      if (pathname.startsWith('/spreadsheets')) return 'Google Sheets';
      if (pathname.startsWith('/presentation')) return 'Google Slides';
    }
  } catch {
    /* not a URL */
  }
  return 'Google Drive';
}

/** Keeps only well-formed attachments (http(s) URLs, known kinds), at most the limit. */
export function cleanAttachments(raw: unknown): AssignmentAttachment[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: AssignmentAttachment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { kind, url, name } = item as Partial<AssignmentAttachment>;
    const link = referenceWorkUrl(typeof url === 'string' ? url : '');
    if (!link || seen.has(link)) continue;
    seen.add(link);
    const safeKind = ATTACHMENT_KINDS.includes(kind as AttachmentKind) ? (kind as AttachmentKind) : attachmentKindForUrl(link);
    const label = typeof name === 'string' && name.trim() ? name.trim().slice(0, 200) : safeKind === 'image' || safeKind === 'file' ? fileNameFromUrl(link) : linkDisplayName(link);
    out.push({ kind: safeKind, url: link, name: label });
    if (out.length >= MAX_ASSIGNMENT_ATTACHMENTS) break;
  }
  return out;
}

/** An assignment's attachments; older work stored a single reference in sample_work_url. */
export function assignmentAttachments(assignment: Pick<Assignment, 'attachments' | 'sample_work_url' | 'sample_work_title'> | null | undefined): AssignmentAttachment[] {
  if (!assignment) return [];
  if (Array.isArray(assignment.attachments)) return cleanAttachments(assignment.attachments);
  const url = referenceWorkUrl(assignment.sample_work_url);
  if (!url) return [];
  return cleanAttachments([{ kind: attachmentKindForUrl(url), url, name: assignment.sample_work_title?.trim() || '' }]);
}

/** Every URL an assignment points at (for storage bookkeeping): attachments plus the legacy field. */
export function assignmentAttachmentUrls(assignment: Pick<Assignment, 'attachments' | 'sample_work_url'> | null | undefined): string[] {
  if (!assignment) return [];
  const urls = (Array.isArray(assignment.attachments) ? assignment.attachments : []).map((a) => a?.url).filter((u): u is string => typeof u === 'string');
  if (assignment.sample_work_url) urls.push(assignment.sample_work_url);
  return [...new Set(urls)];
}
