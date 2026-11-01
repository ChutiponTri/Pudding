import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import {
  TEACHER_OK_COOKIE,
  TEACHER_OK_TTL_SECONDS,
  hasValidTeacherOkCookie,
  readTeacherAccessForProxy,
  teacherOkCookieValue,
} from "@/lib/server/proxyTeacherGate";

const PENDING_APPROVAL_PATH = "/pending-approval";

const isPublicRoute = createRouteMatcher([
  // Logged-out landing page (signed-in teachers get the dashboard here)
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  // Student portal inside LINE: students use LIFF, not Clerk
  "/liff(.*)",
  // API routes authorize each request themselves (Clerk teacher or LIFF student)
  "/api(.*)",
  "/__clerk(.*)",
]);

/**
 * Pages a signed-in teacher may open before the admin approves them (or that
 * are not teacher pages at all). Everything else is checked below.
 */
const skipsTeacherGate = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/liff(.*)",
  "/api(.*)",
  "/__clerk(.*)",
  "/admin(.*)",
  "/pending-approval",
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
