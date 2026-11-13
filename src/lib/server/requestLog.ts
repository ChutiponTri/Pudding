import http from "node:http";

/**
 * Passive request log (home server only, see src/instrumentation.ts). It wraps
 * `http.Server#emit` to note when a request starts and prints a line when its
 * response closes. The request and response are never read, changed or awaited,
 * and any error in here is swallowed, so serving the web and LIFF is unaffected.
 *
 *   14:02:31 200 GET  /api/classrooms        142ms  1.2.3.4  www  LIFF
 *   14:02:33 200 POST /classrooms/abc         820ms  1.2.3.4  home action
 */

const INSTALLED = Symbol.for("pudding.requestLog");

/** Build output, images, fonts: one page load fetches dozens. LOG_STATIC=1 shows them. */
const STATIC = /^\/_next\/(?:static|image)\/|\.(?:js|css|map|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|txt|xml|webmanifest)$/i;

const SLOW_MS = 1000;

function clockTime(): string {
  return new Date().toLocaleTimeString("en-GB", { hour12: false, timeZone: process.env.TZ || "Asia/Bangkok" });
}

function header(req: http.IncomingMessage, name: string): string {
  const value = req.headers[name];
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function clientIp(req: http.IncomingMessage): string {
  // Through the tunnel the socket is cloudflared on this machine; Cloudflare sends the real IP.
  return (
    header(req, "cf-connecting-ip") ||
    header(req, "x-forwarded-for").split(",")[0].trim() ||
    req.socket?.remoteAddress ||
    "-"
  );
}

/** Subdomain (home / www / dev) so both hosts can be told apart. */
function hostLabel(req: http.IncomingMessage): string {
  const host = header(req, "x-forwarded-host") || header(req, "host");
  return host.split(":")[0].split(".")[0] || "-";
}

function tags(req: http.IncomingMessage, url: string): string {
  const out: string[] = [];
  if (header(req, "x-line-access-token")) out.push("LIFF");
  if (header(req, "next-action")) out.push("action");
  if (header(req, "next-router-prefetch")) out.push("prefetch");
  else if (header(req, "rsc") || url.includes("_rsc=")) out.push("nav");
  return out.join(" ");
}

function track(req: http.IncomingMessage, res: http.ServerResponse, logStatic: boolean) {
  const url = req.url || "/";
  const path = url.split("?")[0];
  if (!logStatic && STATIC.test(path)) return;
  const started = performance.now();
  res.once("close", () => {
    try {
      const ms = Math.round(performance.now() - started);
      const status = res.writableFinished ? String(res.statusCode) : "ABORT";
      const mark = res.statusCode >= 500 ? " ‼" : ms >= SLOW_MS ? " (slow)" : "";
      const line = [
        clockTime(),
        status,
        (req.method || "-").padEnd(4),
        path.padEnd(28),
        `${ms}ms`.padStart(7),
        clientIp(req),
        hostLabel(req),
        tags(req, url),
      ]
        .filter(Boolean)
        .join("  ");
      console.log(line + mark);
    } catch {
      // never let logging break a response
    }
  });
}

export function installRequestLog() {
  const g = globalThis as Record<symbol, unknown>;
  if (g[INSTALLED]) return;
  g[INSTALLED] = true;

  const logStatic = process.env.LOG_STATIC === "1";
  const proto = http.Server.prototype;
  const originalEmit = proto.emit;
  proto.emit = function (this: http.Server, event: string | symbol, ...args: unknown[]) {
    if (event === "request") {
      try {
        track(args[0] as http.IncomingMessage, args[1] as http.ServerResponse, logStatic);
      } catch {
        // ignore
      }
    }
    return originalEmit.apply(this, [event, ...args] as Parameters<typeof originalEmit>);
  } as typeof proto.emit;

  console.log(`> Request log on (static files ${logStatic ? "shown" : "hidden"}; REQUEST_LOG=0 to turn off)`);
}
