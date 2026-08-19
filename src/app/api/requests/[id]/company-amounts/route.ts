import { NextResponse } from 'next/server';
import { withRoute, requireSession, type RouteParams } from '@/server/http';
import { hasRole } from '@/server/auth';
import { readTab, updateRow } from '@/server/sheets';
import { fromRequest, nowISO, toRequest } from '@/server/store';
import type { RequestRecord } from '@/shared/types';

// Company Arrangement trips are paid by the company directly, so the
// employee never enters a transport or hotel figure. HR/Admin logs what it
// actually cost here, purely for reporting — it never touches totalClaim or
// what is payable to anyone. One entry per traveller (the requester, plus
// each team member) — costs can differ within the same trip, e.g. one
// person staying an extra night.
export const POST = withRoute(
  async (request: Request, { params }: RouteParams<'id'>) => {
    const session = requireSession(request);
    if (!hasRole(session, 'admin', 'hr')) {
      return NextResponse.json(
        { error: 'Only HR or Admin can record company-arranged amounts.' },
        { status: 403 },
      );
    }
    const { id } = await params;
    const rows = await readTab('Requests');
    const row = rows.find((r) => r.request_id === id);
    if (!row) {
      return NextResponse.json(
        { error: 'Request not found.' },
        { status: 404 },
      );
    }
    const record = toRequest(row);
    if (record.arrangement !== 'company') {
      return NextResponse.json(
        { error: 'This is only for Company Arrangement trips.' },
        { status: 400 },
      );
    }
    const body = await request.json().catch(() => ({}));
    const entries = Array.isArray(body?.entries) ? body.entries : [];
    if (!entries.length) {
      return NextResponse.json({ error: 'Nothing to save.' }, { status: 400 });
    }
    const parsed = new Map<
      string,
      { transport: number; accommodation: number }
    >();
    for (const e of entries) {
      const employeeId = String(e?.employeeId || '');
      const transport = Number(e?.companyTransportAmount);
      const accommodation = Number(e?.companyAccommodationAmount);
      if (
        !employeeId ||
        !Number.isFinite(transport) ||
        transport < 0 ||
        !Number.isFinite(accommodation) ||
        accommodation < 0
      ) {
        return NextResponse.json(
          { error: 'Enter valid amounts for every traveller.' },
          { status: 400 },
        );
      }
      parsed.set(employeeId, { transport, accommodation });
    }

    const own = parsed.get(record.employeeId);
    const updated: RequestRecord = {
      ...record,
      companyTransportAmount: own?.transport ?? record.companyTransportAmount,
      companyAccommodationAmount:
        own?.accommodation ?? record.companyAccommodationAmount,
      companyAmountsBy: `${session.name} <${session.email}>`,
      companyAmountsAt: nowISO(),
      teamMembers: record.teamMembers.map((m) => {
        const entry = parsed.get(m.employeeId);
        return entry
          ? {
              ...m,
              companyTransportAmount: entry.transport,
              companyAccommodationAmount: entry.accommodation,
            }
          : m;
      }),
    };
    await updateRow('Requests', row._row, fromRequest(updated));
    return NextResponse.json({ request: updated });
  },
);
