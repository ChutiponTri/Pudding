/** How a timeline post's LINE message went (see server/classroomPosts). */
export type LinePostStatus = 'sent' | 'failed' | 'quota' | 'no_group' | 'scheduled' | 'limit' | 'card';

/** A post the bot could not send: the teacher shares it from their own LINE (/liff/share). */
export interface LineShare {
  text: string;
  url: string | null;
  /** The card the teacher's LINE sends, when the server sent it along (else loaded from the url's token). */
  messages?: unknown[];
}

/**
 * Why the bot did not send it. 'limit' = this class's re-announcements
 * ("ส่งซ้ำ") are used up for now (rationed, see server/lineTestQuota).
 * 'card' = new work: not a failure, the teacher shares its link to the group
 * and the bot answers with the work card (no quota used).
 */
export type LineUnsentReason = 'failed' | 'quota' | 'no_group' | 'limit' | 'card';

/** On teachers' timeline posts the bot could not send. */
export type PostLineShare = LineShare & { reason: Exclude<LineUnsentReason, 'limit'> };

export const isUnsent = (line: unknown): line is LineUnsentReason =>
  line === 'failed' || line === 'quota' || line === 'no_group' || line === 'limit' || line === 'card';

/** Window event the global LineSharePopup listens for. */
export const LINE_UNSENT_EVENT = 'pudding-line-unsent';

export type LineUnsentDetail = LineShare & {
  reason: LineUnsentReason;
  /** What was posted (work title), shown when several are waiting. */
  title?: string;
  /** The server's explanation (e.g. when the next re-announcement is allowed). */
  note?: string;
  /** Offers "no need to send" (e.g. a deadline reminder): the teacher drops it for good. */
  onDismiss?: () => void;
  /** Set by pendingLineShare: the entry its later answer replaces. */
  pendingId?: string;
  /** Shown at the tap while the server is still preparing it (pendingLineShare). */
  pending?: boolean;
};

/**
 * The bot could not send a post to LINE: open the "share it yourself" popup
 * (LineSharePopup, mounted once for teacher pages). No-op when it was sent.
 */
export function reportLineUnsent(line: unknown, share: LineShare | null | undefined, title?: string, note?: string, onDismiss?: () => void) {
  if (typeof window === 'undefined' || !share || !isUnsent(line)) return;
  window.dispatchEvent(new CustomEvent<LineUnsentDetail>(LINE_UNSENT_EVENT, { detail: { reason: line, ...share, title, note, onDismiss } }));
}

/** Window event that drops a waiting popup (pendingLineShare's cancel). */
export const LINE_PENDING_CANCEL_EVENT = 'pudding-line-pending-cancel';

let pendingCounter = 0;

/**
 * Opens the share popup at the tap, before the server has answered, so the
 * teacher is not left waiting on a blank screen (the server needs several
 * database round trips first). `settle` fills it in with what the server sent
 * (or closes it when that was not something to share); `cancel` closes it
 * (an error, or nothing to send).
 */
export function pendingLineShare(title?: string) {
  if (typeof window === 'undefined') return { settle: reportLineUnsent, cancel: () => {} };
  const pendingId = `pending-${Date.now()}-${++pendingCounter}`;
  let done = false;
  window.dispatchEvent(
    new CustomEvent<LineUnsentDetail>(LINE_UNSENT_EVENT, { detail: { reason: 'card', text: '', url: null, title, pendingId, pending: true } })
  );
  const cancel = () => {
    if (done) return;
    done = true;
    window.dispatchEvent(new CustomEvent<{ pendingId: string }>(LINE_PENDING_CANCEL_EVENT, { detail: { pendingId } }));
  };
  const settle: typeof reportLineUnsent = (line, share, settledTitle, note, onDismiss) => {
    if (done) return;
    if (!share || !isUnsent(line)) return cancel();
    done = true;
    window.dispatchEvent(
      new CustomEvent<LineUnsentDetail>(LINE_UNSENT_EVENT, {
        detail: { reason: line, ...share, title: settledTitle ?? title, note, onDismiss, pendingId },
      })
    );
  };
  return { settle, cancel };
}
