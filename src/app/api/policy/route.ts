import { NextResponse } from 'next/server';
import { withRoute, requireSession } from '@/server/http';
import { loadPolicy } from '@/server/store';

export const GET = withRoute(async (request) => {
  requireSession(request);
  return NextResponse.json(await loadPolicy());
});
