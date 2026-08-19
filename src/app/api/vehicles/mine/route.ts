import { NextResponse } from 'next/server';
import { withRoute, requireSession } from '@/server/http';
import { readTab } from '@/server/sheets';
import { toVehicle } from '@/server/store';

/** The signed-in employee's own vehicle registration, whatever state it is in. */
export const GET = withRoute(async (request) => {
  const session = requireSession(request);
  const rows = await readTab('Vehicles');
  const row = rows
    .map(toVehicle)
    .find((v) => v.employeeId === session.employeeId);
  if (!row) return NextResponse.json({ vehicle: null });
  const { _row, ...vehicle } = row;
  return NextResponse.json({ vehicle });
});
