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

/** " · โควตา LINE เดือนนี้เหลือประมาณ 120 ข้อความ" after a test; empty when unknown. */
export function lineMessagesLeftNote(left: number | undefined | null, tr: (th: string, en: string) => string): string {
  if (typeof left !== 'number') return '';
  return tr(` · โควตา LINE เดือนนี้เหลือประมาณ ${left} ข้อความ`, ` · about ${left} LINE messages left this month`);
}
