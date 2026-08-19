import ExcelJS from 'exceljs';
import { NextResponse } from 'next/server';
import { withRoute, requireSession } from '@/server/http';
import { hasRole } from '@/server/auth';
import { readTab } from '@/server/sheets';
import { toRequest } from '@/server/store';
import {
  matchSettlement,
  normalizeBkash,
  parseSettlementSheet,
} from '@/server/reconcile';

/**
 * Reads a bKash/eMoney settlement export and matches its payout rows against
 * every claim waiting on Finance for payment — a preview only, nothing is
 * written. Finance reviews the matches on screen and calls `/confirm` with
 * whichever ones they accept, so a bad match never silently marks a claim
 * paid.
 */
export const POST = withRoute(async (request) => {
  const session = requireSession(request);
  if (!hasRole(session, 'finance')) {
    return NextResponse.json(
      { error: 'Only Finance can reconcile payments.' },
      { status: 403 },
    );
  }
  const body = await request.json().catch(() => ({}));
  const contentBase64 = String(body?.contentBase64 || '');
  if (!contentBase64) {
    return NextResponse.json({ error: 'No file received.' }, { status: 400 });
  }
  const workbook = new ExcelJS.Workbook();
  try {
    // See the payment-export route for why this cast is needed — exceljs's
    // own types shadow `Buffer` with a bare `extends ArrayBuffer`.
    await workbook.xlsx.load(
      Buffer.from(contentBase64, 'base64') as unknown as ArrayBuffer,
    );
  } catch {
    return NextResponse.json(
      { error: "That doesn't look like a valid .xlsx file." },
      { status: 400 },
    );
  }
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    return NextResponse.json(
      { error: 'The file has no sheet to read.' },
      { status: 400 },
    );
  }
  const fileRows = parseSettlementSheet(worksheet);
  if (!fileRows.length) {
    return NextResponse.json(
      {
        error:
          "No completed payout rows were found in this file — check it's the right export.",
      },
      { status: 400 },
    );
  }

  const rows = await readTab('Requests');
  const candidates = rows
    .map((r) => toRequest(r))
    .filter(
      (r) =>
        ['payment_processing', 'payment_disputed'].includes(r.status) &&
        r.payoutMethod === 'bkash',
    )
    .map((r) => ({
      requestId: r.requestId,
      employeeName: r.employeeName,
      bkashNumber: normalizeBkash(r.bkashNumber),
      expectedAmount: r.finalPayable,
      status: r.status,
    }));

  return NextResponse.json(matchSettlement(fileRows, candidates));
});
