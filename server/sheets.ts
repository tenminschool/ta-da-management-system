/**
 * Thin record layer over the Google Sheet.
 *
 * Every tab is treated as a table: row 1 is the header, rows 2..n are records.
 * Records are plain objects keyed by header name; column order is taken from
 * the live header row, so inserting a column in the sheet does not corrupt
 * reads. Writes go through `appendRow` / `updateRow`, which project an object
 * back onto the live header order.
 */

import { google, type sheets_v4 } from "googleapis";
import { TAB } from "./schema.js";

export type Row = Record<string, string>;

const SPREADSHEET_ID = process.env.SPREADSHEET_ID!;

let client: sheets_v4.Sheets | null = null;

export function sheetsClient(): sheets_v4.Sheets {
  if (client) return client;
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  client = google.sheets({ version: "v4", auth });
  return client;
}

export function spreadsheetId(): string {
  return SPREADSHEET_ID;
}

/**
 * Google caps Sheets at a few hundred reads/writes per minute per user. A busy
 * moment — several approvers working at once — can briefly cross that and come
 * back as 429/503. Those are transient, so retry with backoff rather than
 * surfacing a failure the user can do nothing about.
 */
/**
 * Live count of Sheets API calls, so capacity against Google's per-minute
 * quota can be checked instead of guessed. Exposed on /api/admin/stats.
 */
export const apiCalls = { reads: 0, writes: 0, retries: 0, queuedMs: 0, since: Date.now() };

/**
 * Paces calls so a burst can never blow Google's per-minute quota.
 *
 * Without this, 15 people submitting at the same moment fire ~45 calls at once,
 * Google 429s most of them, and the retries pile on until they run out — the
 * user just sees a failure. A token bucket turns that spike into a short queue
 * instead: everyone still succeeds, the slowest just waits a few seconds.
 *
 * Set below the real quota (300/min) to leave room for anything else touching
 * the same spreadsheet.
 */
class RateLimiter {
  private tokens: number;
  private lastRefill = Date.now();
  /** Chained so waiters are served FIFO rather than all racing for a token. */
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly perMinute: number, private readonly burst: number) {
    this.tokens = burst;
  }

  private refill(): void {
    const now = Date.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.lastRefill) / 60_000) * this.perMinute);
    this.lastRefill = now;
  }

  acquire(): Promise<void> {
    const run = async () => {
      for (;;) {
        this.refill();
        if (this.tokens >= 1) {
          this.tokens -= 1;
          return;
        }
        const waitMs = Math.max(25, ((1 - this.tokens) / this.perMinute) * 60_000);
        apiCalls.queuedMs += waitMs;
        await new Promise((r) => setTimeout(r, waitMs));
      }
    };
    this.queue = this.queue.then(run, run);
    return this.queue;
  }
}

/**
 * Google publishes 300/min but enforces it over shorter windows too, so a
 * short spike still 429s even when the 60-second average is well under. These
 * defaults were tuned against a 15-simultaneous-claim burst; raise them with
 * SHEETS_READS_PER_MINUTE / SHEETS_WRITES_PER_MINUTE if your quota is higher.
 */
const readLimiter = new RateLimiter(Number(process.env.SHEETS_READS_PER_MINUTE) || 150, 10);
const writeLimiter = new RateLimiter(Number(process.env.SHEETS_WRITES_PER_MINUTE) || 150, 10);

/**
 * Serialises a critical section that reads the sheet and then writes based on
 * what it read — request-number allocation, most importantly. Sheets has no
 * transactions, so without this two simultaneous submissions both read the same
 * highest number and both claim it.
 */
let lockChain: Promise<unknown> = Promise.resolve();

export function withSheetLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = lockChain.then(fn, fn);
  lockChain = next.catch(() => undefined);
  return next;
}

export function resetApiCalls(): void {
  apiCalls.reads = 0;
  apiCalls.writes = 0;
  apiCalls.retries = 0;
  apiCalls.since = Date.now();
}

async function retry<T>(fn: () => Promise<T>, attempts = 8, kind: "read" | "write" = "read"): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i += 1) {
    await (kind === "read" ? readLimiter : writeLimiter).acquire();
    if (kind === "read") apiCalls.reads += 1;
    else apiCalls.writes += 1;
    try {
      return await fn();
    } catch (err) {
      apiCalls.retries += 1;
      const status = (err as { status?: number; code?: number }).status ?? (err as { code?: number }).code;
      if (status !== 429 && status !== 503 && status !== 500) throw err;
      lastErr = err;
      // A quota window is 60s, so back off far enough to actually clear it:
      // 1s, 2s, 4s, 8s, 16s, then 30s — plus jitter so parallel callers that
      // were rejected together don't all retry on the same tick.
      const wait = Math.min(30_000, 1000 * 2 ** i) + Math.random() * 1000;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

/**
 * Header cache. Header rows change only when an admin edits the sheet
 * structure, so a short TTL keeps the API-call count down without stranding
 * the server on a stale layout.
 */
const headerCache = new Map<string, { headers: string[]; at: number }>();
const HEADER_TTL_MS = 60_000;

function quote(tab: string): string {
  return `'${tab.replace(/'/g, "''")}'`;
}

export async function getHeaders(tab: string): Promise<string[]> {
  const cached = headerCache.get(tab);
  if (cached && Date.now() - cached.at < HEADER_TTL_MS) return cached.headers;

  const res = await retry(() => sheetsClient().spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${quote(tab)}!1:1`,
  }));
  // A blank cell here is a real column that just has no name — dropping it
  // would compact the array and shift every column after it out of position,
  // since column order elsewhere is taken to be this array's index. The API
  // already omits unpopulated trailing cells, so nothing further to trim.
  const live = res.data.values?.[0] as string[] | undefined;
  // Fall back to the compiled-in schema when the tab exists but is blank, so a
  // half-finished setup still behaves predictably.
  const headers = live?.length ? live : TAB[tab]?.headers ?? [];
  headerCache.set(tab, { headers, at: Date.now() });
  return headers;
}

/** A1 column label for a 0-based index: 0 -> A, 26 -> AA. */
export function colLetter(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** Reads every data row of a tab as objects. `_row` is the 1-based sheet row. */
export async function readTab(tab: string): Promise<(Row & { _row: string })[]> {
  const headers = await getHeaders(tab);
  if (!headers.length) return [];
  const res = await retry(() => sheetsClient().spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${quote(tab)}!A2:${colLetter(headers.length - 1)}`,
    valueRenderOption: "UNFORMATTED_VALUE",
  }));
  const values = (res.data.values || []) as unknown[][];
  const out: (Row & { _row: string })[] = [];
  values.forEach((raw, i) => {
    // Trailing empty rows come back as [] — skip anything with no content.
    if (!raw || raw.every((c) => c === "" || c === null || c === undefined)) return;
    const rec: Row & { _row: string } = { _row: String(i + 2) };
    headers.forEach((h, ci) => {
      const v = raw[ci];
      rec[h] = v === null || v === undefined ? "" : String(v);
    });
    out.push(rec);
  });
  return out;
}

function project(headers: string[], record: Row): string[] {
  return headers.map((h) => {
    const v = record[h];
    return v === undefined || v === null ? "" : String(v);
  });
}

/**
 * The next blank row, found from column A alone rather than `values.append`'s
 * own table auto-detection — that heuristic gets thrown off by any
 * irregularity in existing rows (a blank header cell, rows of differing
 * width from older schema versions) and has been seen landing new data at
 * the wrong column entirely. Column A is always the primary key for every
 * row this app writes, so its length is an unambiguous row count.
 */
async function nextBlankRow(tab: string): Promise<number> {
  const res = await retry(() => sheetsClient().spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${quote(tab)}!A:A`,
    valueRenderOption: "UNFORMATTED_VALUE",
  }));
  return (res.data.values?.length || 1) + 1;
}

/** Appends a row and returns the sheet row number it landed on. */
export async function appendRow(tab: string, record: Row): Promise<number> {
  const headers = await getHeaders(tab);
  const rowNumber = await nextBlankRow(tab);
  await retry(() => sheetsClient().spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${quote(tab)}!A${rowNumber}:${colLetter(headers.length - 1)}${rowNumber}`,
    valueInputOption: "RAW",
    requestBody: { values: [project(headers, record)] },
  }), 8, "write");
  return rowNumber;
}

export async function appendRows(tab: string, records: Row[]): Promise<void> {
  if (!records.length) return;
  const headers = await getHeaders(tab);
  const startRow = await nextBlankRow(tab);
  await retry(() => sheetsClient().spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${quote(tab)}!A${startRow}:${colLetter(headers.length - 1)}${startRow + records.length - 1}`,
    valueInputOption: "RAW",
    requestBody: { values: records.map((r) => project(headers, r)) },
  }), 8, "write");
}

/** Overwrites an entire row (1-based sheet row number) with `record`. */
export async function updateRow(tab: string, rowNumber: number | string, record: Row): Promise<void> {
  const headers = await getHeaders(tab);
  await retry(() => sheetsClient().spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${quote(tab)}!A${rowNumber}:${colLetter(headers.length - 1)}${rowNumber}`,
    valueInputOption: "RAW",
    requestBody: { values: [project(headers, record)] },
  }), 8, "write");
}

/** Blanks out a row in place. Rows are never deleted, so `_row` stays stable. */
export async function clearRow(tab: string, rowNumber: number | string): Promise<void> {
  const headers = await getHeaders(tab);
  await retry(() => sheetsClient().spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${quote(tab)}!A${rowNumber}:${colLetter(headers.length - 1)}${rowNumber}`,
    valueInputOption: "RAW",
    requestBody: { values: [headers.map(() => "")] },
  }), 8, "write");
}

/**
 * Updates many rows of one tab in a single API call. Looping `updateRow` costs
 * one request per row, which burns through the per-minute write quota fast
 * (marking 30 notifications read used to be 30 writes; this makes it one).
 */
export async function updateRows(
  tab: string,
  updates: { row: number | string; record: Row }[],
): Promise<void> {
  if (!updates.length) return;
  const headers = await getHeaders(tab);
  const lastCol = colLetter(headers.length - 1);
  await retry(() => sheetsClient().spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      valueInputOption: "RAW",
      data: updates.map((u) => ({
        range: `${quote(tab)}!A${u.row}:${lastCol}${u.row}`,
        values: [project(headers, u.record)],
      })),
    },
  }), 8, "write");
}

/** Replaces all data rows of a tab in one shot (used by admin config saves). */
export async function replaceTabRows(tab: string, records: Row[]): Promise<void> {
  const headers = await getHeaders(tab);
  const lastCol = colLetter(headers.length - 1);
  await retry(() => sheetsClient().spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: `${quote(tab)}!A2:${lastCol}`,
  }), 8, "write");
  if (!records.length) return;
  await retry(() => sheetsClient().spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${quote(tab)}!A2:${lastCol}${records.length + 1}`,
    valueInputOption: "RAW",
    requestBody: { values: records.map((r) => project(headers, r)) },
  }), 8, "write");
}

/** Reads several tabs in one round trip. */
export async function readTabs(tabs: string[]): Promise<Record<string, (Row & { _row: string })[]>> {
  const headerSets = await Promise.all(tabs.map((t) => getHeaders(t)));
  const ranges = tabs.map((t, i) => `${quote(t)}!A2:${colLetter(Math.max(headerSets[i].length - 1, 0))}`);
  const res = await retry(() => sheetsClient().spreadsheets.values.batchGet({
    spreadsheetId: SPREADSHEET_ID,
    ranges,
    valueRenderOption: "UNFORMATTED_VALUE",
  }));
  const out: Record<string, (Row & { _row: string })[]> = {};
  (res.data.valueRanges || []).forEach((vr, i) => {
    const headers = headerSets[i];
    const rows: (Row & { _row: string })[] = [];
    ((vr.values || []) as unknown[][]).forEach((raw, ri) => {
      if (!raw || raw.every((c) => c === "" || c === null || c === undefined)) return;
      const rec: Row & { _row: string } = { _row: String(ri + 2) };
      headers.forEach((h, ci) => {
        const v = raw[ci];
        rec[h] = v === null || v === undefined ? "" : String(v);
      });
      rows.push(rec);
    });
    out[tabs[i]] = rows;
  });
  return out;
}
