import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET() {
  const liffId = process.env.LINE_LIFF_ID || process.env.NEXT_PUBLIC_LINE_LIFF_ID;
  if (!liffId || liffId === 'your-line-liff-id') {
    return NextResponse.json({ error: 'LINE LIFF is not configured' }, { status: 503 });
  }
  return NextResponse.json({ url: `https://liff.line.me/${liffId}` });
}

export async function POST() {
  return GET();
}
