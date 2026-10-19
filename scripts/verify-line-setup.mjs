// Read-only check of the LINE-only teacher setup: Clerk sign-in methods,
// Supabase columns, and teachers still missing a LINE id. Prints no secrets.
// Usage: npm run line:verify   (reads .env from the project root)
import fs from 'node:fs';
import path from 'node:path';

const env = {};
for (const line of fs.readFileSync(path.resolve(process.cwd(), '.env'), 'utf8').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const i = t.indexOf('=');
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
}

let problems = 0;
const ok = (msg) => console.log(`  ✅ ${msg}`);
const bad = (msg) => { problems += 1; console.log(`  ❌ ${msg}`); };
const warn = (msg) => console.log(`  ⚠️  ${msg}`);

// --- Clerk: the publishable key encodes the Frontend API host; /v1/environment is public.
const pk = env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || '';
const fapi = Buffer.from(pk.split('_').slice(2).join('_'), 'base64').toString().replace(/\$$/, '');
console.log(`\nClerk (${pk.startsWith('pk_live') ? 'production' : 'development'} instance: ${fapi})`);
try {
  const json = await (await fetch(`https://${fapi}/v1/environment`)).json();
  const attrs = json.user_settings?.attributes || {};
  const social = json.user_settings?.social || {};
  attrs.email_address?.used_for_first_factor ? bad('Email sign-in is still ON') : ok('Email sign-in is off');
  attrs.email_address?.required ? bad('Email address is still REQUIRED (LINE sign-ups without an email get stuck)') : ok('Email address is not required');
  attrs.password?.enabled ? bad('Password is still ON') : ok('Password is off');
  attrs.phone_number?.used_for_first_factor ? bad('Phone sign-in is ON') : ok('Phone sign-in is off');
  attrs.username?.used_for_first_factor ? bad('Username sign-in is ON') : ok('Username sign-in is off');
  attrs.passkey?.enabled ? bad('Passkey is ON') : ok('Passkey is off');
  const others = Object.entries(social).filter(([k, v]) => v.enabled && k !== 'oauth_line').map(([k]) => k);
  others.length ? bad(`Other social logins still ON: ${others.join(', ')}`) : ok('No other social logins');
  social.oauth_line?.enabled && social.oauth_line?.authenticatable ? ok('LINE sign-in is ON') : bad('LINE sign-in is OFF');
} catch (e) {
  bad(`Could not read Clerk settings: ${e.message}`);
}

// --- Supabase columns used by automatic LINE linking.
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const headers = { apikey: key, Authorization: `Bearer ${key}` };
console.log('\nSupabase columns');
for (const [table, column] of [
  ['users', 'line_uid'],
  ['users', 'line_link_status'],
  ['users', 'line_bot_friend'],
  ['classrooms', 'line_group_id'],
  ['classrooms', 'line_group_name'],
  ['classrooms', 'line_connection_status'],
  ['classrooms', 'line_connection_token_expires_at'],
  ['classrooms', 'line_connected_at'],
]) {
  const res = await fetch(`${url}/rest/v1/${table}?select=${column}&limit=1`, { headers });
  res.ok ? ok(`${table}.${column}`) : bad(`${table}.${column} is missing — run the SQL in docs/LINE_SETUP_GUIDE.md`);
}

// --- The API routes use the service role; every table must be readable by it.
console.log('\nService-role access (used by /api routes)');
for (const table of ['users', 'courses', 'learning_indicators', 'classrooms', 'classroom_students', 'classroom_posts',
  'attendance_sessions', 'attendance_records', 'assignments', 'questions', 'submissions', 'submission_answers', 'submission_events']) {
  const res = await fetch(`${url}/rest/v1/${table}?select=*&limit=0`, { headers });
  res.ok ? ok(table) : bad(`${table}: no access (${res.status}) — run the "Server (service_role) privileges" SQL`);
}

// --- Teachers who still need to connect LINE to their existing account.
console.log('\nTeachers');
const res = await fetch(`${url}/rest/v1/users?select=id,first_name,line_uid&role=eq.teacher`, { headers });
if (res.ok) {
  const rows = await res.json();
  const missing = rows.filter((row) => !row.line_uid);
  console.log(`  ${rows.length} teacher account(s)`);
  if (missing.length) {
    warn(`${missing.length} without a LINE id: ${missing.map((row) => row.first_name || row.id).join(', ')}`);
    warn('They must connect LINE to their existing account BEFORE email/Google are turned off (see the guide).');
  } else {
    ok('Every teacher has a LINE id');
  }
}

// --- Env needed by the LINE features.
console.log('\nEnvironment');
for (const name of ['LINE_CHANNEL_ACCESS_TOKEN', 'LINE_CHANNEL_SECRET', 'SUPABASE_SERVICE_ROLE_KEY']) {
  env[name] ? ok(name) : bad(`${name} is not set`);
}
env.LINE_LIFF_ID || env.NEXT_PUBLIC_LINE_LIFF_ID ? ok('LINE LIFF ID') : bad('LINE_LIFF_ID / NEXT_PUBLIC_LINE_LIFF_ID is not set');
env.LINE_BOT_BASIC_ID || env.NEXT_PUBLIC_LINE_BOT_BASIC_ID
  ? ok('LINE_BOT_BASIC_ID')
  : warn('LINE_BOT_BASIC_ID is not set — the "add Pudding Bot" button will not appear');

console.log(problems ? `\n${problems} problem(s) found.` : '\nAll checks passed.');
process.exitCode = problems ? 1 : 0;
