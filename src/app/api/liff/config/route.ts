import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const liffId = process.env.LINE_LIFF_ID || process.env.NEXT_PUBLIC_LINE_LIFF_ID || "";
  return NextResponse.json({
    liffId,
    configured: Boolean(liffId && liffId !== "your-line-liff-id"),
  });
}
