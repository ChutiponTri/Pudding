/**
 * What may be stored in R2, shared by the browser (checks before uploading)
 * and the server (enforces). Only images and PDFs; anything bigger than the
 * limit should be shared as a link (Google Drive, OneDrive, …) instead.
 */
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
export const PDF_TYPE = 'application/pdf';
export const ALLOWED_UPLOAD_TYPES: readonly string[] = [...IMAGE_TYPES, PDF_TYPE];

export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const PDF_MAX_BYTES = 10 * 1024 * 1024;

/** Files a student may keep for one assignment before submitting (stops a bucket being flooded). */
export const MAX_DRAFT_FILES_PER_ASSIGNMENT = 30;

export type UploadPurpose = 'submission' | 'sample';

export const isAllowedUploadType = (type: string) => ALLOWED_UPLOAD_TYPES.includes(type);

/** The largest allowed size for a file type; 0 = type not allowed. */
export const maxBytesFor = (type: string) => (type === PDF_TYPE ? PDF_MAX_BYTES : isAllowedUploadType(type) ? IMAGE_MAX_BYTES : 0);

export const formatMegabytes = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)}MB`;

/** Why a file cannot be uploaded (Thai by default, shown to students and teachers), or null when it can. */
export function uploadRejection(file: { type: string; size: number }, language: 'th' | 'en' = 'th'): string | null {
  const th = language === 'th';
  const max = maxBytesFor(file.type);
  if (!max) {
    return th
      ? 'รองรับเฉพาะไฟล์รูปภาพ (JPG, PNG, WEBP, GIF) และ PDF — ไฟล์ชนิดอื่นให้อัปโหลดไว้ที่ Google Drive แล้ววางลิงก์แทน'
      : 'Only images (JPG, PNG, WEBP, GIF) and PDFs are supported — upload other files to Google Drive and paste the link instead';
  }
  if (file.size > max) {
    if (!th) {
      const kind = file.type === PDF_TYPE ? 'PDF' : 'image';
      return `This ${kind} is over ${formatMegabytes(max)} (it is ${formatMegabytes(file.size)}) — shrink it, or upload it to Google Drive and paste the link instead`;
    }
    const kind = file.type === PDF_TYPE ? 'PDF' : 'รูปภาพ';
    return `ไฟล์${kind}ใหญ่เกิน ${formatMegabytes(max)} (ไฟล์นี้ ${formatMegabytes(file.size)}) — ลดขนาดไฟล์ หรืออัปโหลดไว้ที่ Google Drive แล้ววางลิงก์แทน`;
  }
  return null;
}

/**
 * How a borrowed-phone upload names the classmate it is for (their student
 * number, as the phone sends it with the upload and the submission); '' = the
 * phone owner's own work.
 */
export const onBehalfTag = (studentNumber?: unknown) =>
  typeof studentNumber === 'string' ? studentNumber.replace(/\s+/g, '').toLowerCase().slice(0, 40) : '';

/** An http(s) link a student or teacher pasted (a bare "www.…" gets https://); '' when it is not a link. */
export function normalizeLink(raw?: string | null): string {
  const url = (raw || '').trim();
  if (/^https?:\/\/\S+$/i.test(url)) return url;
  return /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(url) ? `https://${url}` : '';
}
