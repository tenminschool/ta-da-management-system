import { NextResponse } from 'next/server';
import { withRoute, requireSession } from '@/server/http';
import { hasRole } from '@/server/auth';
import { readTab, appendRow, updateRow } from '@/server/sheets';
import { fromVehicle, loadPolicy, nowISO, toVehicle } from '@/server/store';
import type { VehicleRegistration } from '@/shared/types';

/**
 * Submits a vehicle for approval, or resubmits one already on file.
 *
 * One row per employee — a resubmission overwrites it and drops the status
 * back to pending, since a changed mileage or fuel type changes the rate a
 * claim would be priced at, and that has to be looked at again.
 */
export const POST = withRoute(async (request) => {
  const session = requireSession(request);
  const body = await request.json().catch(() => ({}));
  const vehicleType =
    body?.vehicleType === 'Car'
      ? 'Car'
      : body?.vehicleType === 'Bike'
        ? 'Bike'
        : '';
  const model = String(body?.model || '').trim();
  const fuelType = String(body?.fuelType || '').trim();
  const mileageKmPerLitre = Number(body?.mileageKmPerLitre);
  const imageLink = String(body?.imageLink || '').trim();

  if (!vehicleType) {
    return NextResponse.json(
      { error: 'Select whether this is a bike or a car.' },
      { status: 400 },
    );
  }
  if (!model) {
    return NextResponse.json(
      { error: "Enter the vehicle's model." },
      { status: 400 },
    );
  }
  const policy = await loadPolicy();
  if (!policy.fuelTypes.some((f) => f.value === fuelType)) {
    return NextResponse.json({ error: 'Select a fuel type.' }, { status: 400 });
  }
  if (!(mileageKmPerLitre > 0)) {
    return NextResponse.json(
      { error: 'Enter how many km this vehicle does on one litre.' },
      { status: 400 },
    );
  }

  const record: VehicleRegistration = {
    employeeId: session.employeeId,
    employeeName: session.name,
    vehicleType,
    model,
    fuelType,
    mileageKmPerLitre,
    imageLink,
    status: 'pending',
    submittedAt: nowISO(),
    reviewedBy: '',
    reviewedAt: '',
    reviewNote: '',
  };

  const rows = await readTab('Vehicles');
  const existing = rows.find((r) => r.employee_id === session.employeeId);
  if (existing) await updateRow('Vehicles', existing._row, fromVehicle(record));
  else await appendRow('Vehicles', fromVehicle(record));

  return NextResponse.json({ vehicle: record });
});

/** The vehicles HR/Admin have to decide on — or everyone's, for a full register. */
export const GET = withRoute(async (request) => {
  const session = requireSession(request);
  if (!hasRole(session, 'admin', 'hr')) {
    return NextResponse.json(
      { error: 'Admin access required.' },
      { status: 403 },
    );
  }
  const scope = new URL(request.url).searchParams.get('scope') || 'pending';
  const rows = (await readTab('Vehicles')).map(toVehicle);
  const filtered =
    scope === 'all' ? rows : rows.filter((v) => v.status === 'pending');
  const vehicles = filtered
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
    .map(({ _row, ...v }) => v);
  return NextResponse.json({ vehicles });
});
