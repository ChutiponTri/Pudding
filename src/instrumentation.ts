import type { Instrumentation } from "next";

/**
 * Request log for the home server (`npm start` behind Cloudflare Tunnel): one line per
 * page/API/server-action request with time, status, duration and the visitor's IP.
 * Off on Vercel and in `next dev` (which logs on its own); REQUEST_LOG=0 turns it off,
 * REQUEST_LOG=1 forces it on. It only listens to requests and never changes them.
 */
function requestLogEnabled(): boolean {
  if (process.env.REQUEST_LOG === "1") return true;
  if (process.env.REQUEST_LOG === "0") return false;
  return !process.env.VERCEL && process.env.NODE_ENV === "production";
}

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !requestLogEnabled()) return;
  const { installRequestLog } = await import("./lib/server/requestLog");
  installRequestLog();
}

export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !requestLogEnabled()) return;
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[error] ${request.method} ${request.path} (${context.routeType} ${context.routePath}): ${message}`);
};
