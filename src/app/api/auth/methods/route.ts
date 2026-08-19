import { NextResponse } from 'next/server';
import { withRoute } from '@/server/http';

/**
 * Which sign-in methods this deployment offers. Unauthenticated on purpose —
 * the login screen needs it before anyone is signed in.
 */
export const GET = withRoute(async () => {
  return NextResponse.json({
    password:
      String(process.env.ALLOW_PASSWORD_LOGIN || '').toLowerCase() === 'true',
  });
});
