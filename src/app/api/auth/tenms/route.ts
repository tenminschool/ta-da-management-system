import { NextResponse } from 'next/server';
import { withRoute } from '@/server/http';
import { signToken } from '@/server/auth';
import { TenMSVerifyError, verifyAccessToken } from '@/server/tenms';
import { allEmployees, managesOthers, rememberAuthId } from '@/server/store';

/**
 * Signs a person in from a verified 10 Minute School session.
 *
 * The browser sends the access token it just obtained; we ask the provider who
 * that token belongs to, then match the email against the Employees sheet.
 * Everything about the person — band, department, roles, line manager — comes
 * from the sheet, never from the identity provider.
 */
export const POST = withRoute(async (request) => {
  const body = await request.json().catch(() => ({}));
  const accessToken = String(body?.accessToken || '');

  let profile;
  try {
    profile = await verifyAccessToken(accessToken);
  } catch (err) {
    const e = err as TenMSVerifyError;
    return NextResponse.json({ error: e.message }, { status: e.status || 401 });
  }

  const email = String(profile.email || '')
    .trim()
    .toLowerCase();
  if (!email) {
    return NextResponse.json(
      {
        error:
          'Your 10 Minute School account has no email address, so it cannot be matched to an employee record.',
      },
      { status: 403 },
    );
  }

  const employee = (await allEmployees()).find(
    (e) => e.email.toLowerCase() === email,
  );
  if (!employee) {
    return NextResponse.json(
      {
        error: `${email} is not in the Employees sheet. Ask PeopleOps to add you before signing in.`,
      },
      { status: 403 },
    );
  }
  if (employee.status !== 'Active') {
    return NextResponse.json(
      { error: 'This account is marked inactive. Contact PeopleOps.' },
      { status: 403 },
    );
  }

  // Record which provider account this person signs in with.
  await rememberAuthId(employee._row, profile.sub);

  const { password: _pw, status: _st, authId: _aid, _row, ...user } = employee;
  return NextResponse.json({
    token: signToken(user),
    user: { ...user, managesOthers: await managesOthers(user.employeeId) },
  });
});
