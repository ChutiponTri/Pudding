import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

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

export default clerkMiddleware(async (auth, request) => {
  if (isPublicRoute(request)) return;

  const { userId } = await auth();
  if (!userId) {
    // Send signed-out visitors to sign in, then back to the page they asked for.
    const signInUrl = new URL("/sign-in", request.url);
    signInUrl.searchParams.set("redirect_url", request.url);
    return NextResponse.redirect(signInUrl);
  }
});

export const config = {
  matcher: [
    // Required for Clerk auto-proxy on *.vercel.app (no custom domain)
    "/__clerk/:path*",
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
