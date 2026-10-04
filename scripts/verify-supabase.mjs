import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const envPath = path.resolve(process.cwd(), '.env');
const lines = fs.readFileSync(envPath, 'utf8').split('\n');
for (const line of lines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx !== -1) {
    process.env[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
  }
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function verify() {
  console.log('====================================================');
  console.log('พุดดิ้ง (Pudding Platform) Supabase Verification');
  console.log('URL:', process.env.NEXT_PUBLIC_SUPABASE_URL);
  console.log('====================================================');

  const tables = [
    'users',
    'courses',
    'learning_indicators',
    'classrooms',
    'classroom_students',
    'assignments',
    'questions',
    'submissions',
    'submission_answers',
    'submission_events'
  ];

  let allExist = true;

  for (const tbl of tables) {
    const { data, error } = await supabase.from(tbl).select('*').limit(2);
    if (error) {
      console.log(`❌ Table '${tbl}': NOT READY (${error.message})`);
      allExist = false;
    } else {
      console.log(`✅ Table '${tbl}': READY (Current row count in sample: ${data.length})`);
    }
  }

  console.log('====================================================');
  if (allExist) {
    console.log('🎉 ALL TABLES ARE VERIFIED AND READY IN SUPABASE!');
  } else {
    console.log('⚠️ Some tables are missing. Please execute `supabase/schema.sql` in your Supabase SQL Editor.');
  }
  console.log('====================================================');
}

verify();
