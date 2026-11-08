import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const liffId = process.env.LINE_LIFF_ID || process.env.NEXT_PUBLIC_LINE_LIFF_ID || "";
  return NextResponse.json({
    liffId,
    /** The teacher menu's own LIFF app (endpoint …/liff/teacher), if one is set up. */
    teacherLiffId: process.env.LINE_TEACHER_LIFF_ID || process.env.NEXT_PUBLIC_LINE_TEACHER_LIFF_ID || "",
    configured: Boolean(liffId && liffId !== "your-line-liff-id"),
  });
}
