import fs from 'fs';
import path from 'path';
import pg from 'pg';

const { Client } = pg;

// Read .env
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

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const projectRef = supabaseUrl.replace('https://', '').split('.')[0];
const dbUrl = process.env.DATABASE_URL || process.env.DIRECT_URL;
const dbPassword = process.env.SUPABASE_DB_PASSWORD || process.env.DB_PASSWORD;
const accessToken = process.env.SUPABASE_ACCESS_TOKEN;

const schemaSqlPath = path.resolve(process.cwd(), 'supabase/schema.sql');
const sql = fs.readFileSync(schemaSqlPath, 'utf8');

async function runWithPg(connectionString) {
  console.log('Connecting to PostgreSQL via pg client...');
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    console.log('Connected! Executing schema.sql...');
    await client.query(sql);
    console.log('🎉 Schema applied successfully to Supabase database!');
    await client.end();
    return true;
  } catch (err) {
    console.error('❌ PostgreSQL execution error:', err.message);
    try { await client.end(); } catch {}
    return false;
  }
}

async function runWithManagementApi(token) {
  console.log('Executing SQL via Supabase Management API for project:', projectRef);
  try {
    const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ query: sql }),
    });

    if (res.ok) {
      console.log('🎉 Schema applied successfully via Supabase Management API!');
      return true;
    } else {
      const errText = await res.text();
      console.error('❌ Management API error:', res.status, errText);
      return false;
    }
  } catch (err) {
    console.error('❌ API call failed:', err.message);
    return false;
  }
}

async function main() {
  console.log('====================================================');
  console.log('พุดดิ้ง (Pudding Platform) Database Setup Script');
  console.log('Project Reference:', projectRef);
  console.log('====================================================');

  if (dbUrl) {
    const ok = await runWithPg(dbUrl);
    if (ok) return;
  } else if (dbPassword) {
    // Try direct host first, then pooler
    const candidates = [
      `postgres://postgres:${encodeURIComponent(dbPassword)}@db.${projectRef}.supabase.co:5432/postgres`,
      `postgres://postgres.${projectRef}:${encodeURIComponent(dbPassword)}@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres`,
      `postgres://postgres.${projectRef}:${encodeURIComponent(dbPassword)}@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`,
      `postgres://postgres.${projectRef}:${encodeURIComponent(dbPassword)}@aws-0-us-east-1.pooler.supabase.com:6543/postgres`,
    ];

    console.log('Attempting connection with SUPABASE_DB_PASSWORD across candidate endpoints...');
    for (const connStr of candidates) {
      const ok = await runWithPg(connStr);
      if (ok) return;
    }
  }

  if (accessToken) {
    const ok = await runWithManagementApi(accessToken);
    if (ok) return;
  }

  // If no direct credentials provided, give instant instructions and URL
  console.log('\n⚠️ No direct Database Password or Access Token found in .env.');
  console.log('Supabase prevents executing arbitrary DDL (CREATE TABLE) via anon key for security.');
  console.log('\n👉 Option 1 (Recommended & Instant):');
  console.log(`1. Open your Supabase SQL Editor: https://supabase.com/dashboard/project/${projectRef}/sql/new`);
  console.log('2. Paste the contents of `supabase/schema.sql` and click "Run".');
  console.log('3. Run `npm run db:verify` to confirm.\n');
  console.log('👉 Option 2 (Automated from terminal):');
  console.log('Add `DATABASE_URL` or `SUPABASE_DB_PASSWORD` to your `.env` file:');
  console.log('Example: DATABASE_URL="postgres://postgres.[ref]:[password]@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres"');
  console.log('Then re-run: npm run db:setup\n');
  console.log('====================================================');
}

main();
