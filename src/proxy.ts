import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";
import {
  TEACHER_OK_COOKIE,
  TEACHER_OK_TTL_SECONDS,
  hasValidTeacherOkCookie,
  readTeacherAccessForProxy,
  teacherOkCookieValue,
} from "@/lib/server/proxyTeacherGate";

const PENDING_APPROVAL_PATH = "/pending-approval";

/**
 * Route list: `{ prefix }` matches any path starting with it, `{ exact }` matches
 * that path with or without a trailing slash. Case-insensitive.
 */
type RouteRule = { prefix: string } | { exact: string };

/**
 * Replaces Clerk's deprecated `createRouteMatcher` with the same matching rules:
 * the path is decoded with `decodeURI` (so `%2F` stays encoded) and repeated
 * slashes are collapsed, so `//api` or `/%61pi` cannot slip past a rule.
 * A malformed path throws an error named `MalformedURLError`, which
 * `clerkMiddleware` turns into a 400 response, as it did before.
 */
function routeMatcher(rules: RouteRule[]) {
  const prefixes = rules.flatMap((r) => ("prefix" in r ? [r.prefix.toLowerCase()] : []));
  const exacts = rules.flatMap((r) => ("exact" in r ? [r.exact.toLowerCase()] : []));
  return (request: NextRequest): boolean => {
    let pathname: string;
    try {
      pathname = decodeURI(request.nextUrl.pathname);
    } catch (cause) {
      const error = new Error(`Malformed encoding in URL path: ${request.nextUrl.pathname}`, { cause });
      error.name = "MalformedURLError";
      throw error;
    }
    pathname = pathname.replace(/\/\/+/g, "/").toLowerCase();
    const trimmed = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
    return prefixes.some((p) => pathname.startsWith(p)) || exacts.includes(trimmed);
  };
}

const isPublicRoute = routeMatcher([
  // Logged-out landing page (signed-in teachers get the dashboard here)
  { exact: "/" },
  { prefix: "/sign-in" },
  { prefix: "/sign-up" },
  // Student portal inside LINE: students use LIFF, not Clerk
  { prefix: "/liff" },
  // API routes authorize each request themselves (Clerk teacher or LIFF student)
  { prefix: "/api" },
  { prefix: "/__clerk" },
]);

/**
 * Pages a signed-in teacher may open before the admin approves them (or that
 * are not teacher pages at all). Everything else is checked below.
 */
const skipsTeacherGate = routeMatcher([
  { prefix: "/sign-in" },
  { prefix: "/sign-up" },
  { prefix: "/liff" },
  { prefix: "/api" },
  { prefix: "/__clerk" },
  { prefix: "/admin" },
  { exact: "/pending-approval" },
]);

export default clerkMiddleware(async (auth, request) => {
  const { userId } = await auth();

  if (!userId) {
    if (isPublicRoute(request)) return;
    // Send signed-out visitors to sign in, then back to the page they asked for.
    const signInUrl = new URL("/sign-in", request.url);
    signInUrl.searchParams.set("redirect_url", request.url);
    return NextResponse.redirect(signInUrl);
  }

  if (skipsTeacherGate(request)) return;

  /*
   * Teacher not approved yet (or profile incomplete): send them to the waiting
   * page before anything renders. The waiting page shows the profile popup
   * when name/institution are missing, and sends them back once approved.
   */
  if (await hasValidTeacherOkCookie(request.cookies.get(TEACHER_OK_COOKIE)?.value, userId)) return;
  const access = await readTeacherAccessForProxy(userId);
  if (access === null) return; // could not check: the client gate and the API still guard
  if (access !== "ok") {
    const response = NextResponse.redirect(new URL(PENDING_APPROVAL_PATH, request.url));
    response.cookies.delete(TEACHER_OK_COOKIE);
    return response;
  }
  const value = await teacherOkCookieValue(userId);
  if (!value) return;
  const response = NextResponse.next();
  response.cookies.set(TEACHER_OK_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: TEACHER_OK_TTL_SECONDS,
  });
  return response;
});

export const config = {
  matcher: [
    // Required for Clerk auto-proxy on *.vercel.app (no custom domain)
    "/__clerk/:path*",
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
