import { S3Client } from '@aws-sdk/client-s3';

const accountId = process.env.R2_ACCOUNT_ID || '';
const accessKeyId = process.env.R2_ACCESS_KEY_ID || '';
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || '';

export const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL || process.env.NEXT_PUBLIC_R2_PUBLIC_URL || '').replace(/\/$/, '');

export const isR2Configured = Boolean(accountId && accessKeyId && secretAccessKey && R2_PUBLIC_URL);

/**
 * Cloudflare R2 S3 Client instance
 * Cloudflare R2 is compatible with AWS S3 API v3
 */
export const r2Client = new S3Client({
  region: 'auto',
  endpoint: accountId ? `https://${accountId}.r2.cloudflarestorage.com` : undefined,
  credentials: {
    accessKeyId: accessKeyId || 'placeholder',
    secretAccessKey: secretAccessKey || 'placeholder',
  },
  // Newer SDKs add a checksum of the (empty) body to presigned PUT URLs, which
  // makes R2 reject the browser's upload; only send checksums R2 requires.
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

/** The bucket key of a public R2 URL; null for anything else (links, other hosts). */
export function keyFromPublicUrl(url?: string | null): string | null {
  if (!url || !R2_PUBLIC_URL || !url.startsWith(`${R2_PUBLIC_URL}/`)) return null;
  const key = decodeURIComponent(url.slice(R2_PUBLIC_URL.length + 1).split('?')[0]);
  return key || null;
}

export const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || 'pudding-submissions';
