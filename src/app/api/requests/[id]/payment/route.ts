import { NextResponse } from 'next/server';
import { withRoute, requireSession, type RouteParams } from '@/server/http';
import { hasRole } from '@/server/auth';
import { readTab, updateRow } from '@/server/sheets';
import { fromRequest, nowISO, toRequest, upsertApproval } from '@/server/store';
import { todayISO } from '@/shared/policy';
import type { RequestRecord } from '@/shared/types';

export const POST = withRoute(
  async (request: Request, { params }: RouteParams<'id'>) => {
    const session = requireSession(request);
    if (!hasRole(session, 'finance')) {
      return NextResponse.json(
        { error: 'Only Finance can record a payment.' },
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
    if (!['payment_processing', 'payment_disputed'].includes(record.status)) {
      return NextResponse.json(
        { error: 'This request is not ready for payment.' },
        { status: 400 },
      );
    }
    const answeringDispute = record.status === 'payment_disputed';
    const body = await request.json().catch(() => ({}));
    const note = String(body?.note || '').trim();
    if (answeringDispute && !note) {
      return NextResponse.json(
        { error: 'Add a remark explaining what happened to this payment.' },
        { status: 400 },
      );
    }

    const paymentMode = String(body?.paymentMode || '');
    const transactionId = String(body?.transactionId || '').trim();
    const amount = Number(body?.amount);
    const paymentDate = String(body?.paymentDate || '').trim() || todayISO();
    if (!paymentMode) {
      return NextResponse.json(
        { error: 'Choose a payment mode.' },
        { status: 400 },
      );
    }
    if (!transactionId) {
      return NextResponse.json(
        { error: 'Transaction ID is required.' },
        { status: 400 },
      );
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json(
        { error: 'Enter the amount paid.' },
        { status: 400 },
      );
    }

    // Recording a payment no longer closes the claim: the employee has to say
    // the money actually arrived first, which is the only check that the account
    // details were right.
    const updated: RequestRecord = {
      ...record,
      status: 'paid',
      completedAt: '',
      // Paying again after a dispute reopens the question.
      paymentAck: '',
      paymentAckAt: '',
      paymentAckNote: '',
      updatedAt: nowISO(),
      paymentMode,
      transactionId,
      paymentDate,
      paidAmount: amount,
      paidBy: `${session.name} <${session.email}>`,
    };
    await updateRow('Requests', row._row, fromRequest(updated));

    await upsertApproval(
      record.requestId,
      record.employeeName,
      [
        {
          group: 'Payment',
          status: 'Paid',
          by: `${session.name} <${session.email}>`,
          remarks: [`${paymentMode} · ${transactionId} · ${amount}`, note]
            .filter(Boolean)
            .join(' — '),
        },
      ],
      {
        currentStage: updated.status,
        lastAction: answeringDispute
          ? `Re-paid by ${session.name}`
          : `Paid by ${session.name}`,
      },
    );

    return NextResponse.json({ request: updated });
  },
);
