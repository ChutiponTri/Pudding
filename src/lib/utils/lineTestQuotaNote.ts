/** The quota part of the API's answer to a LINE test send (see server/lineTestQuota). */
export interface LineTestQuotaInfo {
  remaining: number;
  windowDays: number;
}

/** " (ทดสอบได้อีก 2 ครั้งใน 30 วัน)" after a successful test; empty when unknown. */
export function testQuotaNote(quota: LineTestQuotaInfo | undefined | null, tr: (th: string, en: string) => string): string {
  if (!quota || typeof quota.remaining !== 'number') return '';
  return tr(` (ทดสอบได้อีก ${quota.remaining} ครั้งใน ${quota.windowDays} วัน)`, ` (${quota.remaining} more tests in ${quota.windowDays} days)`);
}
