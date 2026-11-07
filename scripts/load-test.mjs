// Gentle staged, read-only load test against production. Usage: node scripts/load-test.mjs .env [http|realtime|all]
// See docs/LOAD_TEST_REPORT.md. Run it when no class is using the app.
import fs from 'node:fs';

const envFile = process.argv[2];
const mode = process.argv[3] || 'all';
const env = Object.fromEntries(
  fs.readFileSync(envFile, 'utf8').split('\n').filter((l) => /^[A-Z_0-9]+=/.test(l)).map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
  })
);
const SITE = 'https://www.pudding-p.com';
const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;

const STAGES = [10, 25, 50, 100];
const STAGE_SECONDS = 20;
const MAX_ERROR_RATE = 0.05;
const MAX_P95_MS = 3000;

const targets = {
  page: () => fetch(`${SITE}/liff`, { headers: { 'user-agent': 'pudding-loadtest' } }),
  api: () => fetch(`${SITE}/api/liff/config`, { headers: { 'user-agent': 'pudding-loadtest' } }),
  db: () =>
    fetch(`${SB}/rest/v1/assignments?select=id&limit=1`, {
      headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}` },
    }),
};

const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0);

async function runStage(name, fn, concurrency) {
  const end = Date.now() + STAGE_SECONDS * 1000;
  const lat = [];
  let errors = 0;
  const codes = {};
  const worker = async () => {
    while (Date.now() < end) {
      const t = performance.now();
      try {
        const res = await fn();
        await res.arrayBuffer();
        codes[res.status] = (codes[res.status] || 0) + 1;
        if (!res.ok) errors++;
      } catch (e) {
        errors++;
        codes[e.cause?.code || 'ERR'] = (codes[e.cause?.code || 'ERR'] || 0) + 1;
      }
      lat.push(performance.now() - t);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  lat.sort((a, b) => a - b);
  const r = {
    target: name,
    conc: concurrency,
    reqs: lat.length,
    rps: +(lat.length / STAGE_SECONDS).toFixed(1),
    p50: Math.round(pct(lat, 50)),
    p95: Math.round(pct(lat, 95)),
    p99: Math.round(pct(lat, 99)),
    errPct: +((100 * errors) / Math.max(1, lat.length)).toFixed(2),
    codes: JSON.stringify(codes),
  };
  console.log(JSON.stringify(r));
  return r;
}

async function httpTests() {
  for (const [name, fn] of Object.entries(targets)) {
    for (const c of STAGES) {
      const r = await runStage(name, fn, c);
      if (r.errPct / 100 > MAX_ERROR_RATE || r.p95 > MAX_P95_MS) {
        console.log(`STOP ${name}: threshold hit at concurrency ${c}`);
        break;
      }
      await new Promise((ok) => setTimeout(ok, 3000));
    }
  }
}

// Realtime: open N sockets, each joining its own throwaway channel; hold, then close all.
async function realtimeTest() {
  const wsUrl = `${SB.replace('https', 'wss')}/realtime/v1/websocket?apikey=${ANON}&vsn=1.0.0`;
  const sockets = [];
  const open = (i) =>
    new Promise((resolve) => {
      const t = performance.now();
      const ws = new WebSocket(wsUrl);
      const timer = setTimeout(() => resolve({ ok: false, why: 'timeout', ws }), 10000);
      ws.onopen = () =>
        ws.send(JSON.stringify({ topic: `realtime:loadtest-${i}`, event: 'phx_join', payload: { config: {} }, ref: '1' }));
      ws.onmessage = (m) => {
        const msg = JSON.parse(m.data);
        if (msg.event === 'phx_reply' && msg.ref === '1') {
          clearTimeout(timer);
          resolve({ ok: msg.payload?.status === 'ok', why: msg.payload?.response?.reason || msg.payload?.status, ms: performance.now() - t, ws });
        }
      };
      ws.onerror = () => {
        clearTimeout(timer);
        resolve({ ok: false, why: 'socket error', ws });
      };
    });
  for (const target of [25, 50, 100, 150]) {
    const batch = [];
    for (let i = sockets.length; i < target; i++) batch.push(open(i));
    const res = await Promise.all(batch);
    sockets.push(...res);
    const ok = sockets.filter((s) => s.ok).length;
    const failed = res.filter((s) => !s.ok);
    const joinMs = res.filter((s) => s.ms).map((s) => s.ms).sort((a, b) => a - b);
    console.log(JSON.stringify({ realtime: target, connectedOk: ok, newFailures: failed.length, reasons: [...new Set(failed.map((f) => f.why))], joinP50: Math.round(pct(joinMs, 50)), joinP95: Math.round(pct(joinMs, 95)) }));
    if (failed.length > 0) {
      console.log('STOP realtime: failures');
      break;
    }
    await new Promise((ok) => setTimeout(ok, 5000));
  }
  // Check they stay up for a bit, then close everything.
  await new Promise((ok) => setTimeout(ok, 10000));
  const stillOpen = sockets.filter((s) => s.ws.readyState === 1).length;
  console.log(JSON.stringify({ realtimeHeld10s: stillOpen }));
  sockets.forEach((s) => { try { s.ws.close(); } catch {} });
}

if (mode === 'http' || mode === 'all') await httpTests();
if (mode === 'realtime' || mode === 'all') await realtimeTest();
console.log('done');
process.exit(0);
