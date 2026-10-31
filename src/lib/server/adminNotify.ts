import 'server-only';

/**
 * Emails the admin through Resend's HTTP API (https://resend.com), no SDK.
 *
 * Env:
 *   RESEND_API_KEY        required; without it nothing is sent (logged only)
 *   ADMIN_NOTIFY_EMAILS   recipients, comma-separated (default: ADMIN_EMAILS)
 *   EMAIL_FROM            sender (default: Resend's test sender, which can only
 *                         deliver to the email address of the Resend account)
 *   APP_URL               public site URL for links (default: Vercel's production URL)
 */
const list = (value?: string) =>
  (value || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

export function appUrl() {
  const explicit = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return explicit.replace(/\/+$/, '');
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  return vercel ? `https://${vercel}` : '';
}

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

async function sendAdminEmail(subject: string, lines: Array<[string, string]>, link?: { href: string; label: string }) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = list(process.env.ADMIN_NOTIFY_EMAILS).length ? list(process.env.ADMIN_NOTIFY_EMAILS) : list(process.env.ADMIN_EMAILS);
  if (!apiKey || !to.length) {
    console.warn(`[admin email] not sent (set RESEND_API_KEY and ADMIN_EMAILS): ${subject}`);
    return;
  }
  const text = [...lines.map(([k, v]) => `${k}: ${v}`), link ? `\n${link.label}: ${link.href}` : ''].join('\n');
  const html = `
    <div style="font-family:sans-serif;font-size:14px;color:#0f172a">
      <h2 style="margin:0 0 12px">${escapeHtml(subject)}</h2>
      <table style="border-collapse:collapse">
        ${lines.map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#64748b">${escapeHtml(k)}</td><td style="padding:4px 0;font-weight:600">${escapeHtml(v)}</td></tr>`).join('')}
      </table>
      ${link ? `<p style="margin-top:16px"><a href="${escapeHtml(link.href)}" style="background:#f59e0b;color:#0f172a;padding:10px 16px;border-radius:10px;text-decoration:none;font-weight:700">${escapeHtml(link.label)}</a></p>` : ''}
    </div>`;
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.EMAIL_FROM || 'Pudding <onboarding@resend.dev>', to, subject, text, html }),
      cache: 'no-store',
    });
    if (!response.ok) console.warn('[admin email] Resend refused:', response.status, await response.text().catch(() => ''));
  } catch (error) {
    console.warn('[admin email] send failed:', error);
  }
}

/** A new teacher filled in their profile and waits for approval. Never throws. */
export async function notifyAdminNewTeacher(teacher: {
  id: string;
  first_name: string;
  last_name: string;
  institution: string;
  email?: string | null;
}) {
  const base = appUrl();
  await sendAdminEmail(
    `ครูใหม่รอการอนุมัติ: ${teacher.first_name} ${teacher.last_name}`,
    [
      ['ชื่อ', `${teacher.first_name} ${teacher.last_name}`],
      ['สถานศึกษา', teacher.institution],
      ['อีเมล', teacher.email || '-'],
      ['User ID', teacher.id],
    ],
    base ? { href: `${base}/admin/teachers?status=pending`, label: 'เปิดหน้าอนุมัติครู' } : undefined
  );
}
