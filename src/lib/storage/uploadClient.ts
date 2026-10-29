import { authFetch } from '@/lib/auth/lineSession';
import { IMAGE_MAX_BYTES, isAllowedUploadType, uploadRejection } from '@/lib/storage/uploadRules';

/**
 * Browser side of file uploads (see app/api/upload/route.ts): shrinks only
 * images that need it, then sends the file straight to R2 with a signed URL.
 */

export interface StoredUpload {
  url: string;
  key: string;
  filename: string;
  /** The same file was already stored and the user chose to reuse it. */
  reused?: boolean;
}

export interface DuplicateUpload {
  key: string;
  url: string;
  original_filename: string | null;
  created_at: string;
  status: string;
}

export class UploadError extends Error {
  constructor(message: string, readonly tooLarge = false) {
    super(message);
  }
}

/** Photos under this are stored as picked; above it a high-quality re-encode usually halves them. */
const RECOMPRESS_FROM_BYTES = 1.5 * 1024 * 1024;
/** Largest canvas iOS Safari will draw. */
const MAX_CANVAS_PIXELS = 16_000_000;
/** The fallback upload goes through our server, whose platform caps request bodies near 4.5MB. */
const SERVER_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
/** First keep the full resolution; only a photo still over the limit is scaled down (still sharp for grading). */
const ENCODE_ATTEMPTS = [
  { maxEdge: Infinity, quality: 0.9 },
  { maxEdge: 3200, quality: 0.88 },
] as const;

async function encodeJpeg(bitmap: ImageBitmap, maxEdge: number, quality: number): Promise<Blob | null> {
  const { width, height } = bitmap;
  const scale = Math.min(1, maxEdge / Math.max(width, height), Math.sqrt(MAX_CANVAS_PIXELS / (width * height)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  // JPEG has no transparency; keep see-through areas white rather than black.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob?.type === 'image/jpeg' ? blob : null), 'image/jpeg', quality));
}

/**
 * A smaller copy of a large photo at visually the same quality, or the file
 * itself. PNGs (screenshots, diagrams) and GIFs are kept as they are unless
 * over the limit; formats R2 does not accept (e.g. HEIC) become JPEG.
 */
export async function optimizeImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
  const allowed = isAllowedUploadType(file.type);
  if (allowed && file.size <= RECOMPRESS_FROM_BYTES) return file;
  if (allowed && file.type === 'image/png' && file.size <= IMAGE_MAX_BYTES) return file;

  let bitmap: ImageBitmap;
  try {
    // Apply the camera's rotation tag, or phone photos can come out sideways once re-encoded.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(file));
  } catch {
    return file;
  }
  try {
    let best = file;
    for (const { maxEdge, quality } of ENCODE_ATTEMPTS) {
      const blob = await encodeJpeg(bitmap, maxEdge, quality);
      // Only worth it when clearly smaller (or when the original cannot be stored at all).
      if (blob && (!isAllowedUploadType(best.type) || blob.size < best.size * 0.85)) {
        best = new File([blob], file.name.replace(/\.[^.]*$/, '') + '.jpg', { type: 'image/jpeg', lastModified: file.lastModified });
      }
      if (isAllowedUploadType(best.type) && best.size <= IMAGE_MAX_BYTES) break;
    }
    return best;
  } finally {
    bitmap.close();
  }
}

/** SHA-256 of the file as hex, for spotting duplicates; null where the browser cannot hash. */
export async function sha256Hex(file: Blob): Promise<string | null> {
  try {
    if (!globalThis.crypto?.subtle) return null;
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

async function postJson(body: Record<string, unknown>) {
  const res = await authFetch('/api/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new UploadError(json.error || 'อัปโหลดไฟล์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง', !!json.tooLarge);
  return json;
}

async function uploadThroughServer(file: File, assignmentId: string, sha256: string | null, forStudent?: string): Promise<StoredUpload> {
  if (file.size > SERVER_UPLOAD_MAX_BYTES) {
    throw new UploadError('เชื่อมต่อที่เก็บไฟล์ไม่ได้ และไฟล์นี้ใหญ่เกินกว่าจะส่งผ่านเซิร์ฟเวอร์ — กรุณาอัปโหลดไว้ที่ Google Drive แล้ววางลิงก์แทน', true);
  }
  const formData = new FormData();
  formData.append('file', file);
  formData.append('assignment_id', assignmentId);
  if (sha256) formData.append('sha256', sha256);
  if (forStudent) formData.append('for_student', forStudent);
  const res = await authFetch('/api/upload', { method: 'POST', body: formData });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.url) {
    throw new UploadError(res.status === 413 ? 'ไฟล์ใหญ่เกินไป กรุณาลดขนาดไฟล์ หรือวางลิงก์ Google Drive แทน' : json.error || 'อัปโหลดไฟล์ไม่สำเร็จ', res.status === 413);
  }
  return { url: json.url, key: json.key, filename: file.name };
}

/** Deletes an upload that was replaced or removed before handing in (best effort; handed-in files are kept by the server). */
export async function releaseUpload(key?: string | null) {
  if (!key) return;
  try {
    await authFetch('/api/upload', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) });
  } catch {
    // The server also removes forgotten drafts after a few days.
  }
}

/**
 * Stores a file for an assignment ("draft" for a teacher's unsaved one);
 * forStudent = the classmate's student number when uploading on a borrowed phone.
 * onDuplicate decides what to do when this user already stored the same file
 * there: 'reuse' keeps the stored copy, 'replace' uploads again and drops it.
 * Throws UploadError with a message ready to show.
 */
export async function uploadToStorage(
  file: File,
  options: { assignmentId: string; forStudent?: string; onDuplicate?: (duplicate: DuplicateUpload) => 'reuse' | 'replace' | Promise<'reuse' | 'replace'> }
): Promise<StoredUpload> {
  const sha256 = await sha256Hex(file);
  const prepared = await optimizeImage(file);
  const rejection = uploadRejection(prepared);
  if (rejection) throw new UploadError(rejection, isAllowedUploadType(prepared.type));

  const request = {
    action: 'sign',
    filename: prepared.name,
    contentType: prepared.type,
    size: prepared.size,
    sha256,
    assignment_id: options.assignmentId,
    for_student: options.forStudent,
  };
  let signed = await postJson(request);
  let replacedKey: string | null = null;
  if (signed.duplicate) {
    const duplicate = signed.duplicate as DuplicateUpload;
    const choice = options.onDuplicate ? await options.onDuplicate(duplicate) : 'reuse';
    if (choice === 'reuse') return { url: duplicate.url, key: duplicate.key, filename: duplicate.original_filename || file.name, reused: true };
    replacedKey = duplicate.key;
    signed = await postJson({ ...request, force: true });
  }

  let result: StoredUpload;
  let put: Response | null = null;
  try {
    put = await fetch(signed.uploadUrl, { method: 'PUT', headers: signed.headers, body: prepared });
  } catch {
    // Network or CORS failure reaching R2 directly; the signed slot is cleaned up later.
    put = null;
  }
  if (put?.ok) {
    const done = await postJson({ action: 'complete', key: signed.key });
    result = { url: done.url, key: done.key, filename: file.name };
  } else {
    void releaseUpload(signed.key);
    result = await uploadThroughServer(prepared, options.assignmentId, sha256, options.forStudent);
  }
  if (replacedKey && replacedKey !== result.key) void releaseUpload(replacedKey);
  return result;
}
