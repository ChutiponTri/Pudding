// Lets browsers upload straight to the R2 bucket (signed PUT) and admins
// download files for backup (GET). Without this, uploads fall back to going
// through the app server, which only takes files up to about 4MB.
//
// Usage: node scripts/setup-r2-cors.mjs https://your-app.example.com [more origins…]
//    or set R2_CORS_ORIGINS=https://a.example.com,https://b.example.com in .env
// http://localhost:3000 is always included for development.
import { S3Client, PutBucketCorsCommand, GetBucketCorsCommand } from '@aws-sdk/client-s3';
import fs from 'fs';
import path from 'path';

const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1 && !process.env[trimmed.slice(0, eqIdx).trim()]) process.env[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
  }
}

const origins = [
  ...process.argv.slice(2),
  ...(process.env.R2_CORS_ORIGINS || '').split(','),
  'http://localhost:3000',
]
  .map((o) => o.trim().replace(/\/$/, ''))
  .filter(Boolean);
const uniqueOrigins = [...new Set(origins)];

if (uniqueOrigins.length === 1) {
  console.warn('⚠️  Only http://localhost:3000 is allowed. Pass your deployed app URL, e.g.:');
  console.warn('   node scripts/setup-r2-cors.mjs https://pudding.example.com');
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
});

try {
  await s3.send(
    new PutBucketCorsCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedOrigins: uniqueOrigins,
            AllowedMethods: ['PUT', 'GET', 'HEAD'],
            AllowedHeaders: ['content-type'],
            MaxAgeSeconds: 3600,
          },
        ],
      },
    })
  );
  const current = await s3.send(new GetBucketCorsCommand({ Bucket: process.env.R2_BUCKET_NAME }));
  console.log(`✅ CORS set on bucket "${process.env.R2_BUCKET_NAME}":`);
  console.log(JSON.stringify(current.CORSRules, null, 2));
} catch (err) {
  console.error('❌ Could not set CORS:', err.message || err);
  console.error('   The R2 API token needs "Admin Read & Write" to change bucket settings,');
  console.error('   or set the same rule by hand: Cloudflare dashboard → R2 → bucket → Settings → CORS policy.');
  process.exit(1);
}
