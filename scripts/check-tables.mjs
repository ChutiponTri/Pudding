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

async function checkTables() {
  const tableNames = [
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

  console.log('Checking tables in Supabase:');
  for (const tbl of tableNames) {
    const { data, error } = await supabase.from(tbl).select('*').limit(1);
    if (error) {
      console.log(`- ${tbl}: ❌ NOT FOUND or error:`, error.message, `(${error.code})`);
    } else {
      console.log(`- ${tbl}: ✅ EXISTS, rows count in sample:`, data.length);
    }
  }
}

checkTables();
