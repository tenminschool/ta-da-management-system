import { NextResponse } from 'next/server';
import { withRoute, requireSession } from '@/server/http';
import { hasRole } from '@/server/auth';
import { apiCalls, resetApiCalls } from '@/server/sheets';

/**
 * Sheets API usage since the last reset, for checking headroom against
 * Google's 300 reads/min and 300 writes/min quotas.
 */
export const GET = withRoute(async (request) => {
  const session = requireSession(request);
  if (!hasRole(session, 'admin', 'hr')) {
    return NextResponse.json(
      { error: 'Admin access required.' },
      { status: 403 },
    );
  }
  if (new URL(request.url).searchParams.get('reset') === '1') resetApiCalls();
  const seconds = Math.max(1, (Date.now() - apiCalls.since) / 1000);
  return NextResponse.json({
    ...apiCalls,
    windowSeconds: Math.round(seconds),
    readsPerMinute: +(apiCalls.reads / (seconds / 60)).toFixed(1),
    writesPerMinute: +(apiCalls.writes / (seconds / 60)).toFixed(1),
  });
});
