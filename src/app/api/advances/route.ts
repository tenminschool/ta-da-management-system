import { NextResponse } from 'next/server';
import { withRoute, requireSession } from '@/server/http';
import { hasRole } from '@/server/auth';
import { readTab } from '@/server/sheets';
import { managesOthers, toRequest } from '@/server/store';
import { advanceStepFor } from '@/server/requests';

export const GET = withRoute(async (request) => {
  const session = requireSession(request);
  const all = (await readTab('Requests'))
    .map(toRequest)
    .filter((r) => r.advanceRequested > 0);
  const me = session.employeeId;
  // `desk` is only ever other people's advances, and only for the roles that
  // sit in the advance chain.
  const desk =
    (new URL(request.url).searchParams.get('scope') || 'mine') === 'desk';
  if (
    desk &&
    !(hasRole(session, 'hr', 'finance', 'admin') || (await managesOthers(me)))
  ) {
    return NextResponse.json(
      { error: 'You do not review advances.' },
      { status: 403 },
    );
  }
  const rows = desk
    ? all.filter((r) => r.employeeId !== me)
    : all.filter((r) => r.employeeId === me);
  // The client should not have to know the approval rules — tell it which step,
  // if any, this person can take on each advance.
  const withStep = await Promise.all(
    rows.map(async (r) => ({ ...r, myStep: await advanceStepFor(session, r) })),
  );
  return NextResponse.json({ requests: withStep });
});
