import { NextResponse } from 'next/server';
import { withRoute, requireSession } from '@/server/http';
import { readTab, updateRow } from '@/server/sheets';
import { invalidateEmployees } from '@/server/store';

/** Saves this employee's own bKash number, so every future claim starts pre-filled with it. */
export const POST = withRoute(async (request) => {
  const session = requireSession(request);
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
  const row = rows.find((r) => r.employee_id === session.employeeId);
  if (!row) {
    return NextResponse.json(
      { error: 'Your employee record was not found.' },
      { status: 404 },
    );
  }
  const { _row, ...rest } = row;
  await updateRow('Employees', _row, { ...rest, account_number: bkashNumber });
  invalidateEmployees();
  return NextResponse.json({ ok: true, bkashNumber });
});
