/**
 * Turning claims into a spreadsheet Finance can actually work from.
 *
 * The list already holds the whole record, so nothing is fetched again — the
 * file is built from what is on screen.
 */

import type { RequestRecord } from '@/shared/types';

/**
 * One cell.
 *
 * A leading =, +, - or @ makes Excel and Sheets treat the value as a formula,
 * so a name or note could run as code on whoever opens the file. Prefixing an
 * apostrophe keeps the text visible and inert.
 */
function cell(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Everything Finance needs to pay a claim, in the order they read it. */
const COLUMNS: [string, (r: RequestRecord) => unknown][] = [
  ['Request ID', (r) => r.requestId],
  ['Status', (r) => r.status],
  ['Employee ID', (r) => r.employeeId],
  ['Name', (r) => r.employeeName],
  ['Email', (r) => r.email],
  ['Band', (r) => r.band],
  ['Department', (r) => r.department],
  ['Designation', (r) => r.designation],

  ['Travel', (r) => (r.scope === 'inside' ? 'Inside city' : 'Outside city')],
  ['City', (r) => r.city],
  ['Route', (r) => r.route],
  ['Destination type', (r) => r.destinationType],
  ['Destination', (r) => r.destination],
  ['Purpose', (r) => r.purpose],
  ['From', (r) => r.fromDate],
  ['To', (r) => r.toDate],
  ['Trip days', (r) => r.tripDays],
  ['Transport', (r) => r.transportMode],
  ['Team size', (r) => r.teamSize],

  ['Transport (TA)', (r) => r.taAmount],
  ['Per-Diem', (r) => r.perDiemAmount],
  ['Lunch', (r) => r.lunchAllowance],
  ['Accommodation', (r) => r.accommodationAmount],
  ['Rent-a-car', (r) => r.rentACarAmount],
  ['Flight', (r) => r.flightAmount],
  ['Other', (r) => r.otherAmount],
  ['Total claim', (r) => r.totalClaim],
  ['Approved amount', (r) => r.approvedAmount || ''],
  ['Approved by', (r) => r.approvedAmountBy],
  ['Approval note', (r) => r.approvedAmountNote],
  ['Advance requested', (r) => r.advanceRequested],
  ['Advance approved', (r) => r.advanceApproved],
  ['Final payable', (r) => r.finalPayable],

  // What the payment actually needs.
  ['Pay to', (r) => (r.payoutMethod === 'bank' ? 'Bank' : 'bKash')],
  ['bKash number', (r) => (r.payoutMethod === 'bank' ? '' : r.bkashNumber)],
  // Team travel is paid out one bKash number per traveller, not one for the
  // whole claim — Finance needs all of them to actually release the money.
  [
    'Team bKash numbers',
    (r) =>
      r.payoutMethod === 'bank' || r.travelType !== 'team'
        ? ''
        : r.teamMembers
            .map((m) => `${m.name}: ${m.bkashNumber || 'missing'}`)
            .join('; '),
  ],
  ['Bank name', (r) => r.bankName],
  ['Account name', (r) => r.bankAccountName],
  ['Account number', (r) => r.bankAccountNumber],
  ['Routing number', (r) => r.bankRoutingNumber],
  ['Branch', (r) => r.bankBranch],

  ['Submitted', (r) => r.submittedAt],
  ['Line manager', (r) => r.managerEmail],
  ['Exception', (r) => (r.exceptionClaimed ? r.exceptionReason : '')],
  ['Policy notes', (r) => r.policyNotes],
];

export function toCSV(rows: RequestRecord[]): string {
  const lines = [COLUMNS.map(([h]) => cell(h)).join(',')];
  for (const r of rows)
    lines.push(COLUMNS.map(([, read]) => cell(read(r))).join(','));
  return lines.join('\r\n');
}

/**
 * Hands the file to the browser. The byte-order mark is what makes Excel read
 * it as UTF-8 — without it Bengali names arrive as mojibake.
 */
export function downloadCSV(filename: string, rows: RequestRecord[]): void {
  const blob = new Blob([`﻿${toCSV(rows)}`], {
    type: 'text/csv;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
