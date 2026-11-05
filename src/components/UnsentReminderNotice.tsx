'use client';

import { useEffect } from 'react';
import { authFetch } from '@/lib/auth/lineSession';
import { useTeacherAccess } from '@/lib/hooks/useTeacherAccess';
import { reportLineUnsent, type LineUnsentReason } from '@/lib/utils/lineShare';

type UnsentReminder = { assignmentId: string; title: string; reason: Exclude<LineUnsentReason, 'limit'>; text: string; url: string | null };

/** Asked once per page load; closing the popup without sharing asks again next visit. */
const shown = new Set<string>();

/**
 * Teacher pages: deadline reminders the cron could not send to the class LINE
 * group (monthly quota used up, no linked group, LINE refusing it) open the
 * "share it yourself" popup, so the teacher can still send them from their own
 * LINE. Sharing it, or "no need to send", stops the offer for good.
 */
export function UnsentReminderNotice() {
  const { access, userId } = useTeacherAccess();

  useEffect(() => {
    if (access !== 'ok' || !userId) return;
    let cancelled = false;
    authFetch('/api/line/unsent-reminders', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : { reminders: [] }))
      .then((json: { reminders?: UnsentReminder[] }) => {
        if (cancelled) return;
        for (const item of json.reminders || []) {
          if (shown.has(item.assignmentId)) continue;
          shown.add(item.assignmentId);
          const dismiss = () => {
            authFetch('/api/line/unsent-reminders', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ assignmentId: item.assignmentId }),
            }).catch(() => {});
          };
          reportLineUnsent(
            item.reason,
            { text: item.text, url: item.url },
            `แจ้งเตือนส่งงาน: ${item.title}`,
            'บอทส่งแจ้งเตือนกำหนดส่งอัตโนมัติเข้ากลุ่ม LINE ไม่สำเร็จ กดแชร์เพื่อส่งจาก LINE ของคุณครูแทน',
            dismiss
          );
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [access, userId]);

  return null;
}
