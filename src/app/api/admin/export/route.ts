import { NextRequest, NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import {
  ADMIN_DATASETS,
  ADMIN_TABLES,
  getAdmin,
  loadDataset,
  loadTable,
  toCsv,
  type AdminDataset,
  type AdminTable,
} from '@/lib/server/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/export?name=<table|dataset>&format=json|jsonl|csv&anonymize=0|1
 * Downloads a raw table or a derived training dataset. Admins only.
 * Derived datasets are anonymized unless anonymize=0.
 */
export async function GET(request: NextRequest) {
  if (!(await getAdmin())) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const params = request.nextUrl.searchParams;
  const name = params.get('name') || '';
  const format = params.get('format') || 'jsonl';
  if (!['json', 'jsonl', 'csv'].includes(format)) return NextResponse.json({ error: 'format must be json, jsonl or csv' }, { status: 400 });

  const supabase = createServiceSupabaseClient();
  let rows: Record<string, unknown>[];
  try {
    if ((ADMIN_TABLES as readonly string[]).includes(name)) rows = await loadTable(supabase, name as AdminTable);
    else if (name in ADMIN_DATASETS) rows = await loadDataset(supabase, name as AdminDataset, params.get('anonymize') !== '0');
    else return NextResponse.json({ error: 'Unknown table or dataset' }, { status: 400 });
  } catch (error) {
    console.error('[GET /api/admin/export] failed:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Export failed' }, { status: 500 });
  }

  const body =
    format === 'csv' ? toCsv(rows) : format === 'json' ? JSON.stringify(rows, null, 2) : rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
  const contentType = format === 'csv' ? 'text/csv' : format === 'json' ? 'application/json' : 'application/x-ndjson';
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(body, {
    headers: {
      'Content-Type': `${contentType}; charset=utf-8`,
      'Content-Disposition': `attachment; filename="pudding-${name}-${stamp}.${format}"`,
      'Cache-Control': 'no-store',
    },
  });
}
