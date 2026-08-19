import { NextResponse } from 'next/server';
import { withRoute, requireSession, type RouteParams } from '@/server/http';
import { hasRole } from '@/server/auth';
import { readTab, updateRow } from '@/server/sheets';
import { fromUnlockRequest, nowISO, toUnlockRequest } from '@/server/store';
import { applyClaimUnlockExact } from '@/server/admin';
import type { UnlockRequest } from '@/shared/types';

/** Admin/HR grants or declines a claim-window exception, with their own remark either way. */
export const POST = withRoute(
  async (request: Request, { params }: RouteParams<'id'>) => {
    const session = requireSession(request);
    if (!hasRole(session, 'admin', 'hr')) {
      return NextResponse.json(
        { error: 'Admin access required.' },
        { status: 403 },
      );
    }
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const action =
      body?.action === 'approve'
        ? 'approved'
        : body?.action === 'reject'
          ? 'rejected'
          : '';
    const remarks = String(body?.remarks || '').trim();
    if (!action) {
      return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    }
    if (!remarks) {
      return NextResponse.json(
        { error: `Add a remark explaining why this was ${action}.` },
        { status: 400 },
      );
    }

    const rows = await readTab('UnlockRequests');
    const row = rows.find((r) => r.request_id === id);
    if (!row) {
      return NextResponse.json(
        { error: 'Request not found.' },
        { status: 404 },
      );
    }
    const { _row, ...current } = toUnlockRequest(row);
    if (current.status !== 'pending') {
      return NextResponse.json(
        { error: `This request was already ${current.status}.` },
        { status: 400 },
      );
    }

    let unlockFrom = '';
    if (action === 'approved') {
      unlockFrom =
        String(body?.unlockFrom || '').trim() || current.requestedFrom;
      if (!unlockFrom || !/^\d{4}-\d{2}-\d{2}$/.test(unlockFrom)) {
        return NextResponse.json(
          { error: 'Give the date to unlock from, as YYYY-MM-DD.' },
          { status: 400 },
        );
      }
      const ok = await applyClaimUnlockExact(current.employeeId, unlockFrom);
      if (!ok) {
        return NextResponse.json(
          { error: 'That employee no longer exists.' },
          { status: 404 },
        );
      }
    }

    const updated: UnlockRequest = {
      ...current,
      status: action as 'approved' | 'rejected',
      decidedBy: `${session.name} <${session.email}>`,
      decidedAt: nowISO(),
      decisionRemarks: remarks,
      unlockFrom,
    };
    await updateRow('UnlockRequests', _row, fromUnlockRequest(updated));
    return NextResponse.json({ request: updated });
  },
);
