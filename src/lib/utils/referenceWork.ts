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
