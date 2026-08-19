import { NextResponse } from 'next/server';
import { withRoute, requireSession, type RouteParams } from '@/server/http';
import { hasRole } from '@/server/auth';
import { replaceTabRows, type Row } from '@/server/sheets';
import { invalidateEmployees, invalidatePolicy } from '@/server/store';
import { EDITABLE_TABS } from '@/server/admin';

export const POST = withRoute(
  async (request: Request, { params }: RouteParams<'tab'>) => {
    const session = requireSession(request);
    if (!hasRole(session, 'admin', 'hr')) {
      return NextResponse.json(
        { error: 'Admin access required.' },
        { status: 403 },
      );
    }
    const { tab } = await params;
    if (!EDITABLE_TABS.includes(tab)) {
      return NextResponse.json(
        { error: 'That tab is not editable from here.' },
        { status: 400 },
      );
    }
    const body = await request.json().catch(() => ({}));
    const rows = Array.isArray(body?.rows) ? (body.rows as Row[]) : [];
    await replaceTabRows(tab, rows);
    invalidatePolicy();
    invalidateEmployees();
    return NextResponse.json({ ok: true, rows: rows.length });
  },
);
