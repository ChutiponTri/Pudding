# Load Test Report

**Date:** 2026-11-07
**Target:** production, `https://www.pudding-p.com` (Vercel, region `sin1`) and the production Supabase project (Free plan)
**Script:** [`scripts/load-test.mjs`](../scripts/load-test.mjs)
**Result:** ✅ No errors at any stage. No breaking point was reached within the limits tested.

## Summary

| Area | Tested up to | Result | Expected limit |
|---|---|---|---|
| Vercel pages (`/liff`) | 100 concurrent, ~221 req/s | 0% errors, p95 ≤ 749 ms | Scales automatically |
| Vercel functions (`/api/liff/config`) | 100 concurrent, ~297 req/s | 0% errors, p95 ≤ 449 ms | Scales automatically |
| Supabase database reads | 100 concurrent, ~560 req/s | 0% errors, p95 ≤ 241 ms | Well above classroom needs |
| Supabase Realtime connections | 150 open at once | 150/150 joined and stayed open | **~200 on Free (first bottleneck)** |

**Capacity estimate:** about **4–5 classes of 40 students using the app at the same moment** on the Supabase Free plan. Supabase Realtime (live updates) runs out first. Page loads, quizzes and submissions keep working past that point, but new pages stop receiving live updates (new work, scores) until other users close the app.

## Method

- **Read-only.** No data was created or changed.
- **HTTP tests:** closed-loop workers at 10 → 25 → 50 → 100 concurrent requests, 20 seconds per stage, 3 seconds between stages. A target stops early if errors pass 5% or p95 latency passes 3 s.
  - `page`: `GET /liff`
  - `api`: `GET /api/liff/config` (a Vercel function with no database work)
  - `db`: Supabase REST `assignments?select=id&limit=1` (service role)
- **Realtime test:** opened 25 → 50 → 100 → 150 WebSocket connections. Each joined its own throwaway channel (`loadtest-N`). All were held 10 seconds, then closed. The test was capped at 150 so it couldn't take connections from real users under the Free plan's ~200 limit.
- Run from a single client in Thailand. The ~320 ms floor in the Vercel numbers is the network round trip to Singapore, not server time.
- About 37,000 requests in total.

## Results

### HTTP

| Target | Concurrent | Requests | Req/s | p50 | p95 | p99 | Errors |
|---|---:|---:|---:|---:|---:|---:|---:|
| page | 10 | 457 | 22.9 | 382 ms | 700 ms | 1879 ms | 0% |
| page | 25 | 1,418 | 70.9 | 336 ms | 424 ms | 689 ms | 0% |
| page | 50 | 2,906 | 145.3 | 329 ms | 402 ms | 641 ms | 0% |
| page | 100 | 4,425 | 221.3 | 403 ms | 749 ms | 1207 ms | 0% |
| api | 10 | 579 | 28.9 | 328 ms | 449 ms | 967 ms | 0% |
| api | 25 | 1,507 | 75.3 | 323 ms | 383 ms | 638 ms | 0% |
| api | 50 | 2,990 | 149.5 | 323 ms | 386 ms | 587 ms | 0% |
| api | 100 | 5,946 | 297.3 | 323 ms | 382 ms | 607 ms | 0% |
| db | 10 | 1,195 | 59.8 | 160 ms | 183 ms | 417 ms | 0% |
| db | 25 | 2,973 | 148.7 | 160 ms | 202 ms | 424 ms | 0% |
| db | 50 | 5,909 | 295.4 | 160 ms | 198 ms | 393 ms | 0% |
| db | 100 | 11,194 | 559.7 | 163 ms | 241 ms | 413 ms | 0% |

Throughput grew in step with concurrency and latency stayed flat, so neither layer was under strain.

### Realtime

| Open connections | Joined OK | Join p50 | Join p95 |
|---:|---:|---:|---:|
| 25 | 25 | 1048 ms | 1433 ms |
| 50 | 50 | 978 ms | 1367 ms |
| 100 | 100 | 1379 ms | 2227 ms |
| 150 | 150 | 1452 ms | 2306 ms |

All 150 connections were still open after 10 seconds. Join time includes the TLS and WebSocket handshake.

## What was not tested

- **Signed-in requests to `/api/data`.** These need real LINE or Clerk tokens. Each one also verifies the caller and runs a few database queries (~150–200 ms each), so expect about 0.5–1 s per action. Both layers scaled cleanly, so this path is not expected to be the limit.
- **Realtime above 150 connections.** Not tested, to protect live users.
- **Requests from many networks.** Everything came from one client and one IP.

## Other limits to keep in mind

- **Supabase Free plan:** about 200 concurrent Realtime connections (each open student LIFF or teacher page uses one).
- **App request limit (`/api/data`):** 300 requests/min per signed-in user and 60/min per IP without sign-in. Counted per Vercel instance, so it's approximate.
- **LINE Messaging:** 300 messages/month. A group push costs one message per member, so this runs out long before server capacity.

## Recommendations

1. If more than about 4 classes will use the app at the same time, upgrade Supabase to Pro (about 500 Realtime connections).
2. Re-run this test after any plan upgrade or major data-path change, when no class is using the app:
   ```bash
   node scripts/load-test.mjs .env http       # Vercel + database
   node scripts/load-test.mjs .env realtime   # Realtime connections (capped at 150)
   ```
