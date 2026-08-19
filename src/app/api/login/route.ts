import { NextResponse } from 'next/server';
import { withRoute } from '@/server/http';
import { signToken } from '@/server/auth';
import { allEmployees, managesOthers } from '@/server/store';

/**
 * Password sign-in, kept for local development and first-run setup only.
 * Disabled unless ALLOW_PASSWORD_LOGIN is set, because the sheet stores
 * passwords in plain text — 10 Minute School SSO is the real front door.
 */
export const POST = withRoute(async (request) => {
  if (String(process.env.ALLOW_PASSWORD_LOGIN || '').toLowerCase() !== 'true') {
    return NextResponse.json(
      {
        error:
          'Password sign-in is disabled. Use “Login with 10 Minute School”.',
      },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const email = String(body?.email || '')
    .trim()
    .toLowerCase();
  const password = String(body?.password ?? '');
  if (!email || !password) {
    return NextResponse.json(
      { error: 'Email and password are required.' },
      { status: 400 },
    );
  }

  const employee = (await allEmployees()).find(
    (e) => e.email.toLowerCase() === email && e.password === password,
  );
  if (!employee) {
    return NextResponse.json(
      { error: 'Wrong email or password.' },
      { status: 401 },
    );
  }
  if (employee.status !== 'Active') {
    return NextResponse.json(
      { error: 'This account is inactive. Contact PeopleOps.' },
      { status: 403 },
    );
  }

  const { password: _pw, status: _st, authId: _aid, _row, ...user } = employee;
  return NextResponse.json({
    token: signToken(user),
    user: { ...user, managesOthers: await managesOthers(user.employeeId) },
  });
});
