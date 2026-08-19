import { NextResponse } from 'next/server';
import { withRoute, requireSession } from '@/server/http';
import { hasRole } from '@/server/auth';
import { readTab, appendRow } from '@/server/sheets';
import {
  fromUnlockRequest,
  nextUnlockRequestId,
  nowISO,
  toUnlockRequest,
} from '@/server/store';
import type { UnlockRequest } from '@/shared/types';

/** Raises a claim-window exception request — the "Contact HR" button. */
export const POST = withRoute(async (request) => {
  const session = requireSession(request);
  const body = await request.json().catch(() => ({}));
  const reason = String(body?.reason || '').trim();
  const requestedFrom = String(body?.requestedFrom || '').trim();
  if (!reason) {
    return NextResponse.json(
      { error: 'Explain why you need an older date.' },
      { status: 400 },
    );
  }
  if (requestedFrom && !/^\d{4}-\d{2}-\d{2}$/.test(requestedFrom)) {
    return NextResponse.json(
      { error: "That date doesn't look right." },
      { status: 400 },
    );
  }
  const record: UnlockRequest = {
    requestId: await nextUnlockRequestId(),
    employeeId: session.employeeId,
    employeeName: session.name,
    department: session.department,
    reason,
    requestedFrom,
    submittedAt: nowISO(),
    status: 'pending',
    decidedBy: '',
    decidedAt: '',
    decisionRemarks: '',
    unlockFrom: '',
  };
  await appendRow('UnlockRequests', fromUnlockRequest(record));
  return NextResponse.json({ request: record });
});

/** Your own past requests, or — for Admin/HR — the ones waiting on a decision (or every one, for the register). */
export const GET = withRoute(async (request) => {
  const session = requireSession(request);
  const scope = new URL(request.url).searchParams.get('scope') || 'mine';
  const rows = (await readTab('UnlockRequests')).map(toUnlockRequest);
  let filtered: (UnlockRequest & { _row: string })[];
  if (scope === 'mine') {
    filtered = rows.filter((r) => r.employeeId === session.employeeId);
  } else {
    if (!hasRole(session, 'admin', 'hr')) {
      return NextResponse.json(
        { error: 'Admin access required.' },
        { status: 403 },
      );
    }
    filtered =
      scope === 'all' ? rows : rows.filter((r) => r.status === 'pending');
  }
  const requests = filtered
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
    .map(({ _row, ...r }) => r);
  return NextResponse.json({ requests });
});
