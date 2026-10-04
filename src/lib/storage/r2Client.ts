import { S3Client } from '@aws-sdk/client-s3';

const accountId = process.env.R2_ACCOUNT_ID || '';
const accessKeyId = process.env.R2_ACCESS_KEY_ID || '';
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || '';

export const isR2Configured = Boolean(accountId && accessKeyId && secretAccessKey);

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
});

export const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || 'pudding-submissions';
export const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL || process.env.NEXT_PUBLIC_R2_PUBLIC_URL || 'https://storage.pudding.ac.th').replace(/\/$/, '');
