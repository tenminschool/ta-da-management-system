import { NextResponse } from 'next/server';
import { withRoute, requireSession } from '@/server/http';
import { hasRole } from '@/server/auth';
import { getHeaders, readTabs } from '@/server/sheets';
import { EDITABLE_TABS } from '@/server/admin';

export const GET = withRoute(async (request) => {
  const session = requireSession(request);
  if (!hasRole(session, 'admin', 'hr')) {
    return NextResponse.json(
      { error: 'Admin access required.' },
      { status: 403 },
    );
  }
  const data = await readTabs(EDITABLE_TABS);
  const headers = Object.fromEntries(
    await Promise.all(
      EDITABLE_TABS.map(async (t) => [t, await getHeaders(t)] as const),
    ),
  );
  return NextResponse.json({ tabs: EDITABLE_TABS, headers, data });
});
