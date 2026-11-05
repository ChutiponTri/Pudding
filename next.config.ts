import type { NextConfig } from "next";

/**
 * Sent with every response. Only this site may show its pages in a frame
 * (no clickjacking from other sites); file types are not guessed; other sites
 * get the origin only, not full URLs (which may carry ids).
 */
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

const nextConfig: NextConfig = {
  // `npm run dev:https` serves the dev server as https://dev.pudding-p.com, the only kind of
  // origin the production Clerk instance accepts (see scripts/dev-https.sh).
  allowedDevOrigins: ["dev.pudding-p.com", "*.pudding-p.com"],
  env: {
    NEXT_PUBLIC_LINE_LIFF_ID: process.env.LINE_LIFF_ID || process.env.NEXT_PUBLIC_LINE_LIFF_ID || "",
    LINE_LIFF_ID: process.env.LINE_LIFF_ID || process.env.NEXT_PUBLIC_LINE_LIFF_ID || "",
  },
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
