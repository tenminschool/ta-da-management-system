import { NextResponse } from 'next/server';
import { withRoute, requireSession } from '@/server/http';
import { hasRole } from '@/server/auth';
import { readTab, updateRow } from '@/server/sheets';
import { fromRequest, nowISO, toRequest, upsertApproval } from '@/server/store';
import { todayISO } from '@/shared/policy';
import type { RequestRecord } from '@/shared/types';

/** Marks every accepted match paid, the same way a manual "Mark paid" would. */
export const POST = withRoute(async (request) => {
  const session = requireSession(request);
  if (!hasRole(session, 'finance')) {
    return NextResponse.json(
      { error: 'Only Finance can reconcile payments.' },
      { status: 403 },
    );
  }
  const body = await request.json().catch(() => ({}));
  const filename = String(body?.filename || 'settlement file').trim();
  const picked = Array.isArray(body?.matches) ? body.matches : [];
  if (!picked.length) {
    return NextResponse.json(
      { error: 'Nothing selected to confirm.' },
      { status: 400 },
    );
  }

  const results: { requestId: string; ok: boolean; error?: string }[] = [];
  for (const m of picked) {
    const requestId = String(m?.requestId || '');
    const receiptNo = String(m?.receiptNo || '').trim();
    const fileAmount = Number(m?.fileAmount);
    const completionDate = String(m?.completionDate || '').trim() || todayISO();
    if (
      !requestId ||
      !receiptNo ||
      !Number.isFinite(fileAmount) ||
      fileAmount <= 0
    ) {
      results.push({
        requestId: requestId || '(unknown row)',
        ok: false,
        error: 'Malformed row — skipped.',
      });
      continue;
    }
    try {
      const rows = await readTab('Requests');
      const row = rows.find((r) => r.request_id === requestId);
      if (!row) {
        results.push({ requestId, ok: false, error: 'Request not found.' });
        continue;
      }
      const record = toRequest(row);
      if (!['payment_processing', 'payment_disputed'].includes(record.status)) {
        results.push({
          requestId,
          ok: false,
          error: `Already at "${record.status}" — skipped.`,
        });
        continue;
      }
      const answeringDispute = record.status === 'payment_disputed';
      const updated: RequestRecord = {
        ...record,
        status: 'paid',
        completedAt: '',
        paymentAck: '',
        paymentAckAt: '',
        paymentAckNote: '',
        updatedAt: nowISO(),
        paymentMode: 'bKash',
        transactionId: receiptNo,
        paymentDate: completionDate,
        paidAmount: fileAmount,
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
            remarks: `bKash · ${receiptNo} · ${fileAmount} — auto-reconciled from ${filename}.`,
          },
        ],
        {
          currentStage: updated.status,
          lastAction: `${answeringDispute ? 'Re-paid' : 'Paid'} by ${session.name} (auto-reconcile)`,
        },
      );
      results.push({ requestId, ok: true });
    } catch (err) {
      results.push({ requestId, ok: false, error: (err as Error).message });
    }
  }
  return NextResponse.json({ results });
});
