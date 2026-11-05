/** How a timeline post's LINE message went (see server/classroomPosts). */
export type LinePostStatus = 'sent' | 'failed' | 'quota' | 'no_group' | 'scheduled' | 'limit';

/** A post the bot could not send: the teacher shares it from their own LINE (/liff/share). */
export interface LineShare {
  text: string;
  url: string | null;
}

/**
 * Why the bot did not send it. 'limit' = this class's re-announcements
 * ("ส่งซ้ำ") are used up for now (rationed, see server/lineTestQuota).
 */
export type LineUnsentReason = 'failed' | 'quota' | 'no_group' | 'limit';

/** On teachers' timeline posts the bot could not send. */
export type PostLineShare = LineShare & { reason: Exclude<LineUnsentReason, 'limit'> };

export const isUnsent = (line: unknown): line is LineUnsentReason =>
  line === 'failed' || line === 'quota' || line === 'no_group' || line === 'limit';

/** Window event the global LineSharePopup listens for. */
export const LINE_UNSENT_EVENT = 'pudding-line-unsent';

export type LineUnsentDetail = LineShare & {
  reason: LineUnsentReason;
  /** What was posted (work title), shown when several are waiting. */
  title?: string;
  /** The server's explanation (e.g. when the next re-announcement is allowed). */
  note?: string;
};

/**
 * The bot could not send a post to LINE: open the "share it yourself" popup
 * (LineSharePopup, mounted once for teacher pages). No-op when it was sent.
 */
export function reportLineUnsent(line: unknown, share: LineShare | null | undefined, title?: string, note?: string) {
  if (typeof window === 'undefined' || !share || !isUnsent(line)) return;
  window.dispatchEvent(new CustomEvent<LineUnsentDetail>(LINE_UNSENT_EVENT, { detail: { reason: line, ...share, title, note } }));
}
