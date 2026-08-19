import { NextResponse } from 'next/server';
import { withRoute, requireSession } from '@/server/http';
import { managesOthers } from '@/server/store';
import { currentSession } from '@/server/requests';

export const GET = withRoute(async (request) => {
  const session = requireSession(request);
  // Recomputed rather than read from the token, so a saved bKash number, a
  // claim-window unlock, a hierarchy change etc. all take effect on the next
  // page load rather than requiring the person to sign out and back in.
  const { expiresAt, ...fresh } = await currentSession(session);
  return NextResponse.json({
    user: { ...fresh, managesOthers: await managesOthers(fresh.employeeId) },
  });
});
