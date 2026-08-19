import ExcelJS from 'exceljs';
import { NextResponse } from 'next/server';
import { withRoute, requireSession } from '@/server/http';
import { hasRole } from '@/server/auth';
import { readTab } from '@/server/sheets';
import { loadPolicy, nowISO, toRequest } from '@/server/store';
import { teamPayoutSplit } from '@/shared/policy';
import { canView } from '@/server/requests';
import { paymentTemplate } from '@/server/payment-template';

export const POST = withRoute(async (request) => {
  const session = requireSession(request);
  if (!hasRole(session, 'admin', 'finance')) {
    return NextResponse.json(
      { error: 'Only Finance or Admin can export a payment file.' },
      { status: 403 },
    );
  }
  const body = await request.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body?.ids) ? body.ids.map(String) : [];
  if (!ids.length) {
    return NextResponse.json(
      { error: 'Select at least one claim to export.' },
      { status: 400 },
    );
  }

  const policy = await loadPolicy();
  const rows = await readTab('Requests');
  const byId = new Map(rows.map((r) => [r.request_id, toRequest(r)]));
  const hasChildren = new Set(rows.map((r) => r.linked_to).filter(Boolean));

  // A bank payout has no wallet to disburse to — those, along with anything
  // the caller cannot see, are left out and reported back rather than
  // silently dropped. A team claim already split into linked children at
  // submission (see teamPayoutSplit / childFromMain) pays through its own
  // reduced finalPayable like any other request — the split already
  // happened, each child is its own row. Only a team claim from before that
  // — no linked children — still needs the split worked out here.
  const skipped: string[] = [];
  const skippedTravellers: string[] = [];
  const payouts: { wallet: string; principal: number }[] = [];
  for (const id of ids) {
    const record = byId.get(id);
    if (
      !record ||
      !canView(session, record) ||
      record.payoutMethod === 'bank'
    ) {
      skipped.push(id);
      continue;
    }
    const isUnsplitTeam =
      record.travelType === 'team' &&
      record.teamMembers.length > 0 &&
      !hasChildren.has(id);
    const rowsToPay = isUnsplitTeam
      ? teamPayoutSplit(record, policy)
      : [
          {
            employeeId: record.employeeId,
            name: record.employeeName,
            bkashNumber: record.bkashNumber,
            amount:
              record.approvedAmount > 0
                ? record.approvedAmount
                : record.finalPayable,
          },
        ];
    let any = false;
    for (const p of rowsToPay) {
      if (!(p.amount > 0)) continue;
      if (!p.bkashNumber) {
        skippedTravellers.push(`${id}: ${p.name}`);
        continue;
      }
      payouts.push({ wallet: p.bkashNumber, principal: p.amount });
      any = true;
    }
    if (!any) skipped.push(id);
  }
  if (!payouts.length) {
    return NextResponse.json(
      { error: 'None of the selected claims pay out to a bKash number.' },
      { status: 400 },
    );
  }

  const workbook = new ExcelJS.Workbook();
  // exceljs's own .d.ts shadows `Buffer` with a bare `extends ArrayBuffer`
  // interface, which the real (newer, generic) Node Buffer type doesn't
  // structurally satisfy — an upstream typing bug, not a runtime concern.
  await workbook.xlsx.load((await paymentTemplate()) as unknown as ArrayBuffer);
  // Values were written by us, not by Excel, so nothing is marked dirty —
  // without this the Final/Fee/bKash sheets would open still showing blank.
  workbook.calcProperties.fullCalcOnLoad = true;
  const client = workbook.getWorksheet('Client');
  if (!client)
    throw new Error('The payment template is missing its Client sheet.');
  payouts.forEach((p, i) => {
    const row = 4 + i;
    client.getCell(`B${row}`).value = p.wallet;
    client.getCell(`C${row}`).value = p.principal;
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const headers: Record<string, string> = {
    'Content-Type':
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="bkash-payment-${nowISO().slice(0, 10)}.xlsx"`,
  };
  if (skipped.length)
    headers['X-Skipped-Ids'] = encodeURIComponent(skipped.join(','));
  if (skippedTravellers.length)
    headers['X-Skipped-Travellers'] = encodeURIComponent(
      skippedTravellers.join(','),
    );
  return new NextResponse(Buffer.from(buffer), { headers });
});
