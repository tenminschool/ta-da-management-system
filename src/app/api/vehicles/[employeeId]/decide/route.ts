import { NextResponse } from 'next/server';
import { withRoute, requireSession, type RouteParams } from '@/server/http';
import { hasRole } from '@/server/auth';
import { readTab, updateRow } from '@/server/sheets';
import { fromVehicle, nowISO, toVehicle } from '@/server/store';
import type { VehicleRegistration } from '@/shared/types';

export const POST = withRoute(
  async (request: Request, { params }: RouteParams<'employeeId'>) => {
    const session = requireSession(request);
    if (!hasRole(session, 'admin', 'hr')) {
      return NextResponse.json(
        { error: 'Admin access required.' },
        { status: 403 },
      );
    }
    const { employeeId } = await params;
    const body = await request.json().catch(() => ({}));
    const action =
      body?.action === 'approve'
        ? 'approved'
        : body?.action === 'reject'
          ? 'rejected'
          : '';
    const remarks = String(body?.remarks || '').trim();
    if (!action) {
      return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    }
    if (action === 'rejected' && !remarks) {
      return NextResponse.json(
        { error: 'Add a remark explaining why this vehicle was not approved.' },
        { status: 400 },
      );
    }

    const rows = await readTab('Vehicles');
    const row = rows.find((r) => r.employee_id === employeeId);
    if (!row) {
      return NextResponse.json(
        { error: 'No vehicle registration for that employee.' },
        { status: 404 },
      );
    }
    const { _row, ...current } = toVehicle(row);

    const updated: VehicleRegistration = {
      ...current,
      status: action,
      reviewedBy: `${session.name} <${session.email}>`,
      reviewedAt: nowISO(),
      reviewNote: remarks,
    };
    await updateRow('Vehicles', _row, fromVehicle(updated));
    return NextResponse.json({ vehicle: updated });
  },
);
