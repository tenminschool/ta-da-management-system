import { NextResponse } from 'next/server';
import { withRoute, requireSession } from '@/server/http';
import { hasRole } from '@/server/auth';
import { applyClaimUnlock } from '@/server/admin';

export const POST = withRoute(async (request) => {
  const session = requireSession(request);
  if (!hasRole(session, 'admin', 'hr')) {
    return NextResponse.json(
      { error: 'Admin access required.' },
      { status: 403 },
    );
  }
  const body = await request.json().catch(() => ({}));
  const employeeId = String(body?.employeeId || '').trim();
  const from = String(body?.from || '').trim();
  // An empty date takes the unlock away again.
  if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    return NextResponse.json(
      { error: 'Give the date to unlock from, as YYYY-MM-DD.' },
      { status: 400 },
    );
  }
  const ok = await applyClaimUnlock(employeeId, from);
  if (!ok) {
    return NextResponse.json(
      { error: 'No employee with that ID.' },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true, employeeId, from });
});
