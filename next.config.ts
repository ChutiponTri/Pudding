import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_LINE_LIFF_ID: process.env.LINE_LIFF_ID || process.env.NEXT_PUBLIC_LINE_LIFF_ID || "",
    LINE_LIFF_ID: process.env.LINE_LIFF_ID || process.env.NEXT_PUBLIC_LINE_LIFF_ID || "",
  },
};

export default nextConfig;
