import { NextRequest, NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { getAdmin } from '@/lib/server/admin';
import { deleteRecord, getRecord, isAdminTable, listRecords, updateRecord } from '@/lib/server/adminRecords';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404 });

/**
 * Admin record access (admins only; others get 404 like the admin page).
 * GET    ?table=&id=            one record
 * GET    ?table=&q=&page=       a page of records, searched
 * PATCH  { table, id, changes } edit columns of a record
 * DELETE { table, id }          delete a record (and its stored files)
 */
export async function GET(request: NextRequest) {
  if (!(await getAdmin())) return notFound();
  const params = request.nextUrl.searchParams;
  const table = params.get('table');
  if (!isAdminTable(table)) return NextResponse.json({ error: 'Unknown table' }, { status: 400 });
  const supabase = createServiceSupabaseClient();
  try {
    const id = params.get('id');
    if (id) {
      const record = await getRecord(supabase, table, id);
      return record ? NextResponse.json({ record }) : notFound();
    }
    return NextResponse.json(await listRecords(supabase, table, { q: params.get('q') || '', page: Number(params.get('page')) || 1 }));
  } catch (error) {
    console.error('[GET /api/admin/records] failed:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const admin = await getAdmin();
  if (!admin) return notFound();
  const { table, id, changes } = await request.json().catch(() => ({}));
  if (!isAdminTable(table) || typeof id !== 'string' || !changes || typeof changes !== 'object') {
    return NextResponse.json({ error: 'table, id and changes are required' }, { status: 400 });
  }
  try {
    const record = await updateRecord(createServiceSupabaseClient(), table, id, changes);
    if (!record) return notFound();
    console.log(`[admin] ${admin.id} updated ${table}/${id}:`, Object.keys(changes).join(', '));
    return NextResponse.json({ record });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Update failed' }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const admin = await getAdmin();
  if (!admin) return notFound();
  const { table, id } = await request.json().catch(() => ({}));
  if (!isAdminTable(table) || typeof id !== 'string') return NextResponse.json({ error: 'table and id are required' }, { status: 400 });
  try {
    if (!(await deleteRecord(createServiceSupabaseClient(), table, id))) return notFound();
    console.log(`[admin] ${admin.id} deleted ${table}/${id}`);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Delete failed' }, { status: 400 });
  }
}
