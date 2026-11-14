---
name: two-servers
description: Pudding runs on two servers — the home computer (main, `next start` behind Cloudflare Tunnel) and Vercel (backup) — switched by a Cloudflare failover Worker. Use before renaming/removing API routes (especially /api/liff/config or anything a scheduler or LINE calls), adding env vars, adding scheduled jobs or in-memory state, rebuilding/restarting the home server, or reading the home request log.
---

# Two servers: home computer + Vercel

## Topology

| Host | Goes to |
|---|---|
| `www.pudding-p.com` | **Whichever server is live.** A CNAME the failover Worker flips between the home Cloudflare Tunnel and Vercel. |
| `home.pudding-p.com` | Always the home computer (tunnel), whatever `www` points to. |
| `dev.pudding-p.com` | `npm run dev:https` on this machine (see local-dev-clerk). |

On the home computer, `cloudflared.service` (systemd) runs the tunnel and `npm start` (`next start`) runs the app from `.next`.

**Failover Worker:** lives in the Cloudflare dashboard (Workers, Cron Trigger every minute), *not* in this repo. Every minute it calls `https://home.pudding-p.com/api/liff/config`, with 3 checks 5 s apart and a 6 s timeout each. Home counts as healthy only if it gets 200 with `configured: true`.
- `www` on home + all 3 checks fail → switch to Vercel.
- `www` on Vercel ≥ 5 min + all 3 checks pass → switch back home.
- Env `PAUSED=true` stops all switching. Opening the Worker's URL shows `{ www: "home computer" | "Vercel", since }`.

To see which server answered: `curl -sI https://www.pudding-p.com/ | grep -i x-vercel-id`. That header is only there when Vercel answered.

## Rules

1. **`/api/liff/config` is the health check.** Keep it cheap, Clerk-free (under `liff/`, which `src/proxy.ts` skips) and returning `configured`. Don't rename or move it, or make it call Supabase/LINE. If you must change it, update `HEALTH_URL` in the Worker first, or the Worker sends `www` to Vercel for good. Its callers from `2a06:98c0:…` (Cloudflare) in the home log are the Worker.
2. **Both servers must run the same code.** Pushing to `main` deploys Vercel. Home needs `git pull`, `npm run build`, and restarting `npm start`. Until both are updated, a failover changes the app's version under users. Renaming or removing a route is the risky case: an external caller (pg_cron, LINE webhook, LIFF endpoint URLs in the LINE console) may get 404 on one server only.
3. **Both servers must have the same env.** Home reads `.env` and Vercel reads its Production env vars. A new or rotated variable goes in **both** (Clerk, Supabase, LINE, R2, `LINE_REMINDER_CRON_SECRET`). A mismatch shows up only after a failover, e.g. 401s from pg_cron on one server.
4. **External callers hit `www`, so either server can answer:** pg_cron's `/api/cron/daily` (`supabase_daily_cron.sql`) and the LINE webhook. Every job must be safe to run on either server and if it runs twice. Example: the daily summary claims `users.line_daily_summary_on` in the DB before pushing. A run that fails during a switch is covered by the next hourly run.
5. **No correctness in process memory.** Module-level variables and caches (e.g. `lastSweepAt` in `assignmentDrafts.ts`) are separate on each server and reset on restart or failover. Shared state goes in Supabase, and cross-client events go through realtime signals.
6. **Vercel is billed, home is not.** While `www` is on Vercel, the CPU quota applies: follow the `vercel-cpu` skill for everything, since any day can be a Vercel day.

## Rebuilding the home server

`npm run build` rewrites `.next` under the running `next start`. Requests can then fail until the restart, and the Worker may switch `www` to Vercel and keep it there for ≥ 5 minutes. That's expected and harmless if Vercel already runs the same commit (rule 2). Order:

1. Push first, and wait for the Vercel deploy to finish, so the backup is current.
2. `git pull && npm run build`
3. Stop the old `next-server` (otherwise you get EADDRINUSE and keep serving the old build), then `npm start`.
4. Check: `curl -s -o /dev/null -w '%{http_code}' https://home.pudding-p.com/api/liff/config` → 200. For a set maintenance window, set the Worker's `PAUSED=true` instead.

If `next build` fails type checking on `.next/dev/types/validator.ts` naming a deleted route, that's stale dev output: `rm -rf .next/dev/types` and build again.

## Home request log

Only on the home server's `next start` (`src/instrumentation.ts`, `src/lib/server/requestLog.ts`; `REQUEST_LOG=0/1`). Line format: time, status, method, path, ms, client IP (`cf-connecting-ip`), host label (`home` = direct or the Worker, `www` = real traffic while home is live, `dev`), tags (`LIFF`, `action`, `nav`, `prefetch`). Vercel requests never show up here; use Vercel's logs for those.

## Checking a change that touches routes or env

```bash
for h in home.pudding-p.com www.pudding-p.com; do
  curl -s -o /dev/null -w "$h %{http_code}\n" -X POST https://$h/api/cron/daily   # 401 = route exists (no secret)
done
```
Run it once with `www` on home and once on Vercel (look at the `x-vercel-id` header), or check the Vercel deployment's own URL.
