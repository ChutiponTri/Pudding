import 'server-only';
import { buildLiffUrl } from '@/lib/line/liffLink';
import { sameSignature, signShort } from '@/lib/server/inviteCodes';

/**
 * The check-in QR code on the teacher's screen. It changes every
 * QR_ROTATE_MS, and a code is accepted for QR_VALID_MS after it appeared (time
 * for the phone to open LINE and the check-in page), so a photo of the
 * screen sent to someone at home stops working within seconds. The code is
 * an HMAC of the session and the time slot: nothing to store.
 */
export const QR_ROTATE_MS = 8_000;
const QR_VALID_MS = 30_000;

const slotOf = (ms: number) => Math.floor(ms / QR_ROTATE_MS);
const sign = (sessionId: string, slot: number) => signShort(`attendance-qr:${sessionId}:${slot}`);

/** The code shown now, and when the next one replaces it. */
export function attendanceQrKey(sessionId: string, now = Date.now()) {
  const slot = slotOf(now);
  return { key: `${slot.toString(36)}.${sign(sessionId, slot)}`, nextAt: (slot + 1) * QR_ROTATE_MS };
}

export type QrCheck = 'ok' | 'expired' | 'invalid';

/** Whether a scanned code belongs to this session and is still fresh. */
export function checkAttendanceQrKey(sessionId: string, key: unknown, now = Date.now()): QrCheck {
  if (typeof key !== 'string') return 'invalid';
  const [slotText, signature] = key.split('.');
  const slot = parseInt(slotText || '', 36);
  if (!Number.isFinite(slot) || !signature || !sameSignature(signature, sign(sessionId, slot))) return 'invalid';
  const shownAt = slot * QR_ROTATE_MS;
  // Not from the future (a little clock slack), and not older than QR_VALID_MS.
  if (shownAt > now + QR_ROTATE_MS || now - shownAt > QR_VALID_MS + QR_ROTATE_MS) return 'expired';
  return 'ok';
}

/** What the QR code holds: the student check-in page with this session and code. */
export function attendanceQrUrl(classroomId: string, sessionId: string, key: string): string | null {
  const url = buildLiffUrl({ classroomId, view: 'attendance' });
  return url ? `${url}&sid=${encodeURIComponent(sessionId)}&qr=${encodeURIComponent(key)}` : null;
}
