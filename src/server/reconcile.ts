/**
 * Matches a bKash/eMoney settlement export (an .xlsx bank statement) against
 * claims waiting on Finance for payment, so a bulk payout run can be marked
 * paid from the statement instead of one "Mark paid" click per claim.
 */

import type ExcelJS from 'exceljs';

export interface SettlementRow {
  receiptNo: string;
  /** yyyy-mm-dd, blank if the file had no parseable completion time. */
  completionDate: string;
  /** Absolute value of the Withdrawn cell — what actually left the account. */
  amount: number;
  /** Normalised to bare 01XXXXXXXXX. */
  bkashNumber: string;
  rawOppositeParty: string;
  status: string;
}

export interface MatchCandidate {
  requestId: string;
  employeeName: string;
  /** Normalised to bare 01XXXXXXXXX; empty if the claim's number doesn't look like one. */
  bkashNumber: string;
  expectedAmount: number;
  status: string;
}

export type Confidence = 'exact' | 'close' | 'mismatch';

export interface ReconcileMatch {
  requestId: string;
  employeeName: string;
  bkashNumber: string;
  expectedAmount: number;
  fileAmount: number;
  amountDiff: number;
  confidence: Confidence;
  receiptNo: string;
  completionDate: string;
  requestStatus: string;
}

export interface ReconcileResult {
  matches: ReconcileMatch[];
  unmatchedClaims: MatchCandidate[];
  unmatchedFileRows: SettlementRow[];
}

const HEADER_LABELS = [
  'receipt no.',
  'withdrawn',
  'opposite party',
  'transaction status',
  'details',
  'completion time',
];

/** Bare 11-digit local form (01XXXXXXXXX), stripping an optional 88/+880 country code. */
export function normalizeBkash(raw: string): string {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length < 11) return '';
  const last11 = digits.slice(-11);
  return /^01[3-9]\d{8}$/.test(last11) ? last11 : '';
}

/** Pulls the first bKash-shaped number out of free text like "...to 8801842026161 - NAME". */
function extractBkash(text: string): string {
  const found = String(text || '').match(/(?:\+?88)?01[3-9]\d{8}/);
  return found ? normalizeBkash(found[0]) : '';
}

function parseAmountCell(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n =
    typeof v === 'number' ? v : Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function parseDateCell(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const d = new Date(String(v ?? ''));
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/**
 * Finds the header row by content rather than a fixed row number — bKash's
 * own export has five title/summary rows above it, and that padding isn't
 * guaranteed to stay the same size from one report to the next.
 */
export function parseSettlementSheet(
  worksheet: ExcelJS.Worksheet,
): SettlementRow[] {
  const width = Math.max(worksheet.columnCount, 20);
  let headerRow = -1;
  let colMap: Record<string, number> = {};

  for (let r = 1; r <= worksheet.rowCount; r++) {
    const row = worksheet.getRow(r);
    const found: Record<string, number> = {};
    for (let c = 1; c <= width; c++) {
      const v = String(row.getCell(c).value ?? '')
        .trim()
        .toLowerCase();
      if (HEADER_LABELS.includes(v)) found[v] = c;
    }
    if (found['receipt no.'] && found['withdrawn'] && found['opposite party']) {
      headerRow = r;
      colMap = found;
      break;
    }
  }
  if (headerRow < 0) return [];

  const rows: SettlementRow[] = [];
  for (let r = headerRow + 1; r <= worksheet.rowCount; r++) {
    const row = worksheet.getRow(r);
    const cell = (label: string) =>
      colMap[label] ? row.getCell(colMap[label]).value : undefined;

    const receiptNo = String(cell('receipt no.') ?? '').trim();
    if (!receiptNo) continue;

    const status = String(cell('transaction status') ?? '').trim();
    if (!/completed/i.test(status)) continue;

    // Money out has a value in Withdrawn; money in (e.g. the bulk "eMoney
    // Issue" top-up) has it in Paid In instead and nothing to match here.
    const withdrawn = parseAmountCell(cell('withdrawn'));
    if (withdrawn === null) continue;

    const oppositeParty = String(cell('opposite party') ?? '');
    const details = String(cell('details') ?? '');
    const bkashNumber = extractBkash(oppositeParty) || extractBkash(details);
    if (!bkashNumber) continue;

    rows.push({
      receiptNo,
      completionDate: parseDateCell(cell('completion time')),
      amount: Math.abs(withdrawn),
      bkashNumber,
      rawOppositeParty: oppositeParty.trim(),
      status,
    });
  }
  return rows;
}

function confidenceFor(expected: number, actual: number): Confidence {
  const diff = Math.abs(expected - actual);
  if (diff < 0.01) return 'exact';
  return diff <= Math.max(10, expected * 0.01) ? 'close' : 'mismatch';
}

/**
 * The phone number is the match key; amount is only there to pick the right
 * pairing when several transactions or claims share one number (e.g. one
 * person paid out on two different claims in the same run). Pairs are chosen
 * smallest-amount-difference-first across the whole file, not claim by claim,
 * so two close candidates don't accidentally steal each other's obvious match.
 */
export function matchSettlement(
  fileRows: SettlementRow[],
  candidates: MatchCandidate[],
): ReconcileResult {
  const fileByNumber = new Map<string, SettlementRow[]>();
  for (const row of fileRows) {
    if (!row.bkashNumber) continue;
    const list = fileByNumber.get(row.bkashNumber) ?? [];
    list.push(row);
    fileByNumber.set(row.bkashNumber, list);
  }

  const claimsByNumber = new Map<string, MatchCandidate[]>();
  const unmatchedClaims: MatchCandidate[] = [];
  for (const c of candidates) {
    if (!c.bkashNumber) {
      unmatchedClaims.push(c);
      continue;
    }
    const list = claimsByNumber.get(c.bkashNumber) ?? [];
    list.push(c);
    claimsByNumber.set(c.bkashNumber, list);
  }

  const matches: ReconcileMatch[] = [];
  const usedFileRows = new Set<SettlementRow>();

  for (const [number, claimList] of claimsByNumber) {
    const fileList = (fileByNumber.get(number) ?? []).filter(
      (r) => !usedFileRows.has(r),
    );
    if (!fileList.length) {
      unmatchedClaims.push(...claimList);
      continue;
    }

    const remainingClaims = [...claimList];
    const remainingFile = [...fileList];
    while (remainingClaims.length && remainingFile.length) {
      let best = { ci: 0, fi: 0, diff: Infinity };
      remainingClaims.forEach((c, ci) => {
        remainingFile.forEach((f, fi) => {
          const diff = Math.abs(c.expectedAmount - f.amount);
          if (diff < best.diff) best = { ci, fi, diff };
        });
      });
      const claim = remainingClaims[best.ci];
      const file = remainingFile[best.fi];
      matches.push({
        requestId: claim.requestId,
        employeeName: claim.employeeName,
        bkashNumber: claim.bkashNumber,
        expectedAmount: claim.expectedAmount,
        fileAmount: file.amount,
        amountDiff: best.diff,
        confidence: confidenceFor(claim.expectedAmount, file.amount),
        receiptNo: file.receiptNo,
        completionDate: file.completionDate,
        requestStatus: claim.status,
      });
      usedFileRows.add(file);
      remainingClaims.splice(best.ci, 1);
      remainingFile.splice(best.fi, 1);
    }
    unmatchedClaims.push(...remainingClaims);
  }

  const unmatchedFileRows = fileRows.filter(
    (r) => r.bkashNumber && !usedFileRows.has(r),
  );
  const order: Record<Confidence, number> = { exact: 0, close: 1, mismatch: 2 };
  matches.sort(
    (a, b) =>
      order[a.confidence] - order[b.confidence] || a.amountDiff - b.amountDiff,
  );

  return { matches, unmatchedClaims, unmatchedFileRows };
}
