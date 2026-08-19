import { NextResponse } from 'next/server';
import { withRoute, requireSession, type RouteParams } from '@/server/http';
import { readTab, updateRow } from '@/server/sheets';
import { invalidateEmployees } from '@/server/store';

/**
 * Saves a bKash number against a teammate's own record — used from the
 * team-payout picker, so it's there next time without retyping it. Whoever
 * it actually belongs to can still open their own claim form and correct it
 * (myBkashField, the same control this endpoint's sibling above serves).
 */
export const POST = withRoute(
  async (request: Request, { params }: RouteParams<'id'>) => {
    requireSession(request);
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const bkashNumber = String(body?.bkashNumber || '').replace(/[\s-]/g, '');
    if (!/^01[3-9]\d{8}$/.test(bkashNumber)) {
      return NextResponse.json(
        {
          error:
            'That does not look like a bKash number — 11 digits starting 01, e.g. 01712345678.',
        },
        { status: 400 },
      );
    }
    const rows = await readTab('Employees');
    const row = rows.find((r) => r.employee_id === id);
    if (!row) {
      return NextResponse.json(
        { error: 'No employee with that ID.' },
        { status: 404 },
      );
    }
    const { _row, ...rest } = row;
    await updateRow('Employees', _row, {
      ...rest,
      account_number: bkashNumber,
    });
    invalidateEmployees();
    return NextResponse.json({ ok: true, employeeId: id, bkashNumber });
  },
);
