import { NextResponse } from 'next/server';
import { withRoute, requireSession, type RouteParams } from '@/server/http';
import { readTab, updateRow } from '@/server/sheets';
import { fromRequest, nowISO, toRequest, upsertApproval } from '@/server/store';
import type { RequestRecord } from '@/shared/types';

/**
 * The employee says whether the money actually arrived.
 *
 * This is the only check that the account details were right — a claim marked
 * paid against a mistyped bKash number looks settled from every other angle.
 * Saying no sends it back to Finance rather than closing it.
 */
export const POST = withRoute(
  async (request: Request, { params }: RouteParams<'id'>) => {
    const session = requireSession(request);
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
    if (record.employeeId !== session.employeeId) {
      return NextResponse.json(
        { error: 'Only the person who claimed this can confirm the payment.' },
        { status: 403 },
      );
    }
    if (record.status !== 'paid') {
      return NextResponse.json(
        { error: 'This claim is not waiting for you to confirm a payment.' },
        { status: 400 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const received = body?.received === true;
    const note = String(body?.note || '').trim();
    if (!received && !note) {
      return NextResponse.json(
        {
          error:
            'Tell Finance what happened — they need something to look into.',
        },
        { status: 400 },
      );
    }

    // An outstanding advance keeps the claim open even once the money is
    // confirmed: it closes when the advance is settled.
    const advanceOutstanding = record.advanceRequested > 0 && !record.settledAt;
    const updated: RequestRecord = {
      ...record,
      status: received
        ? advanceOutstanding
          ? 'paid'
          : 'completed'
        : 'payment_disputed',
      completedAt: received && !advanceOutstanding ? nowISO() : '',
      paymentAck: received ? 'received' : 'not_received',
      paymentAckAt: nowISO(),
      paymentAckNote: note,
      updatedAt: nowISO(),
    };
    await updateRow('Requests', row._row, fromRequest(updated));

    await upsertApproval(
      record.requestId,
      record.employeeName,
      [
        {
          group: 'Payment',
          status: received ? 'Confirmed by employee' : 'Not received',
          by: `${session.name} <${session.email}>`,
          remarks: note,
        },
      ],
      {
        currentStage: updated.status,
        lastAction: received
          ? `Payment confirmed by ${session.name}`
          : `Payment disputed by ${session.name}`,
      },
    );

    return NextResponse.json({ request: updated });
  },
);
