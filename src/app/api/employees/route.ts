import { NextResponse } from 'next/server';
import { withRoute, requireSession } from '@/server/http';
import { allEmployees } from '@/server/store';

/** Employee lookup for the team-member picker: search by ID or name. */
export const GET = withRoute(async (request) => {
  requireSession(request);
  const q = (new URL(request.url).searchParams.get('q') || '')
    .trim()
    .toLowerCase();
  const rows = (await allEmployees()).filter((e) => e.status === 'Active');
  const matched = q
    ? rows.filter(
        (e) =>
          e.employeeId.toLowerCase().includes(q) ||
          e.name.toLowerCase().includes(q) ||
          e.email.toLowerCase().includes(q),
      )
    : rows;
  return NextResponse.json({
    employees: matched.slice(0, 25).map((e) => ({
      employeeId: e.employeeId,
      name: e.name,
      email: e.email,
      department: e.department,
      designation: e.designation,
      band: e.band,
      gender: e.gender,
    })),
  });
});
