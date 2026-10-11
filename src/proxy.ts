import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/liff(.*)",
  "/api(.*)",
]);

export default clerkMiddleware(async (auth, request) => {
  // Public routes pass through freely
});

export const config = {
  matcher: [
    // Required for Clerk auto-proxy on *.vercel.app (no custom domain)
    "/__clerk/:path*",
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
