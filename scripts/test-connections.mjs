import { createClient } from '@supabase/supabase-js';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import fs from 'fs';
import path from 'path';

// Parse .env manually
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      process.env[key] = val;
    }
  }
}

console.log('Testing Supabase Connection...');
console.log('URL:', process.env.NEXT_PUBLIC_SUPABASE_URL);

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function testSupabase() {
  try {
    const { data, error } = await supabase.from('courses').select('count', { count: 'exact', head: true });
    if (error) {
      console.log('Supabase query returned:', error.message, '(code:', error.code, ')');
      if (error.code === 'PGRST205' || error.message.includes('relation') || error.message.includes('does not exist')) {
        console.log('✅ Supabase connected successfully! (Tables do not exist yet, as expected for an empty database)');
        return true;
      } else {
        console.log('⚠️ Supabase returned an unexpected error:', error);
        return false;
      }
    } else {
      console.log('✅ Supabase connected and table exists! Data:', data);
      return true;
    }
  } catch (err) {
    console.error('❌ Supabase connection error:', err);
    return false;
  }
}

async function testR2() {
  console.log('\nTesting Cloudflare R2 Connection...');
  console.log('Bucket:', process.env.R2_BUCKET_NAME);
  console.log('Account ID:', process.env.R2_ACCOUNT_ID);

  try {
    const s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });

    const cmd = new ListObjectsV2Command({
      Bucket: process.env.R2_BUCKET_NAME,
      MaxKeys: 5,
    });

    const res = await s3.send(cmd);
    console.log('✅ Cloudflare R2 connected successfully!');
    console.log('Objects in bucket:', res.KeyCount || 0);
    return true;
  } catch (err) {
    console.error('❌ Cloudflare R2 error:', err.message || err);
    return false;
  }
}

async function run() {
  await testSupabase();
  await testR2();
}

run();
