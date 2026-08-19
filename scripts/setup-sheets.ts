/**
 * Creates, repairs and — when it finds the previous layout — migrates the
 * spreadsheet to the current schema.
 *
 * Safe to re-run. Existing request data is read with the *live* headers before
 * anything is rewritten, remapped onto the new columns, and written back; the
 * old multi-row helper tabs are folded into single cells / column groups and
 * then removed.
 *
 *   npm run setup
 */

import { OBSOLETE_TABS, TABS } from '../src/server/schema.js';
import {
  sheetsClient,
  spreadsheetId,
  colLetter,
} from '../src/server/sheets.js';

type Rec = Record<string, string>;

const quote = (t: string) => `'${t.replace(/'/g, "''")}'`;
const nn = (v: string | undefined) =>
  v === undefined || v === null ? '' : String(v);

/** Reads a tab into objects using whatever headers it currently has. */
async function readLive(title: string): Promise<Rec[]> {
  const sheets = sheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    // Wide enough for any tab this schema will realistically grow to — a
    // narrower fixed range here silently truncates a wide tab's columns,
    // which made every run see the last several headers as "new" and rewrite
    // the tab from a partial read, on Requests once it passed 78 columns.
    range: `${quote(title)}!A1:ZZ`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const values = (res.data.values || []) as unknown[][];
  if (values.length < 2) return [];
  const headers = (values[0] as string[]).map(String);
  return values
    .slice(1)
    .filter((row) =>
      row?.some((c) => c !== '' && c !== null && c !== undefined),
    )
    .map((row) =>
      Object.fromEntries(headers.map((h, i) => [h, nn(row[i] as string)])),
    );
}

async function main() {
  if (!process.env.SPREADSHEET_ID || !process.env.GOOGLE_CLIENT_EMAIL) {
    throw new Error(
      'Missing SPREADSHEET_ID / GOOGLE_CLIENT_EMAIL — check your .env file.',
    );
  }

  const sheets = sheetsClient();
  const id = spreadsheetId();

  const meta = await sheets.spreadsheets.get({ spreadsheetId: id });
  const existing = new Map(
    (meta.data.sheets || []).map((s) => [
      s.properties!.title!,
      s.properties!.sheetId!,
    ]),
  );
  console.log(`Spreadsheet: ${meta.data.properties?.title}`);
  console.log(
    `Existing tabs (${existing.size}): ${[...existing.keys()].join(', ') || '(none)'}\n`,
  );

  // ── 1. Snapshot anything that needs remapping, before headers change ──────
  const snapshot: Record<string, Rec[]> = {};
  for (const t of [
    'Requests',
    'Approvals',
    'RequestLegs',
    'TeamMembers',
    'Payments',
    'Advances',
  ]) {
    if (existing.has(t)) snapshot[t] = await readLive(t);
  }
  const oldRequests =
    snapshot.Requests?.length &&
    'AdvanceApprovedAmount' in snapshot.Requests[0];
  const oldApprovals =
    snapshot.Approvals?.length && 'ApprovalID' in snapshot.Approvals[0];
  if (oldRequests || oldApprovals) {
    console.log(
      `Previous layout detected — migrating ${snapshot.Requests?.length || 0} request(s).\n`,
    );
  }

  // ── 2. Create missing tabs ────────────────────────────────────────────────
  const created: string[] = [];
  const addRequests = TABS.filter((t) => !existing.has(t.title)).map((t) => {
    created.push(t.title);
    return {
      addSheet: {
        properties: {
          title: t.title,
          gridProperties: {
            rowCount: 1000,
            columnCount: Math.max(t.headers.length, 8),
            frozenRowCount: 1,
          },
          tabColor: t.color,
        },
      },
    };
  });
  if (addRequests.length) {
    const res = await sheets.spreadsheets.batchUpdate({
      spreadsheetId: id,
      requestBody: { requests: addRequests },
    });
    (res.data.replies || []).forEach((r) => {
      const p = r.addSheet?.properties;
      if (p) existing.set(p.title!, p.sheetId!);
    });
    console.log(`Created tab(s): ${created.join(', ')}`);
  }

  // A tab kept from the old layout may be narrower than the new header row.
  const widen = TABS.filter((t) => !created.includes(t.title)).map((t) => ({
    updateSheetProperties: {
      properties: {
        sheetId: existing.get(t.title)!,
        gridProperties: { columnCount: Math.max(t.headers.length, 8) },
      },
      fields: 'gridProperties.columnCount',
    },
  }));
  if (widen.length)
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: id,
      requestBody: { requests: widen },
    });

  // ── 3. Realign columns, then write header rows ────────────────────────────
  // Rows are stored positionally, so inserting or moving a column would leave
  // every value after it under the wrong header. Instead of assuming the
  // schema only ever appends, each tab is re-read under its *live* headers and
  // written back mapped by NAME onto the new order. Columns that are new come
  // out empty; existing values follow their own header wherever it moved to.
  const realign: { title: string; rows: string[][]; added: string[] }[] = [];
  for (const t of TABS) {
    const rows = await readLive(t.title);
    if (!rows.length) continue;
    const live = Object.keys(rows[0]);
    if (
      live.length === t.headers.length &&
      live.every((c, i) => c === t.headers[i])
    )
      continue;

    const added = t.headers.filter((h) => !live.includes(h));
    const dropped = live.filter((h) => !t.headers.includes(h));
    console.log(
      `  ${t.title}: realigning ${rows.length} row(s)` +
        (added.length ? ` — new: ${added.join(', ')}` : '') +
        (dropped.length ? ` — no longer used: ${dropped.join(', ')}` : ''),
    );
    realign.push({
      title: t.title,
      rows: rows.map((r) => t.headers.map((h) => nn(r[h]))),
      added,
    });
  }

  for (const t of TABS) {
    await sheets.spreadsheets.values.clear({
      spreadsheetId: id,
      range: `${quote(t.title)}!1:1`,
    });
  }
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: id,
    requestBody: {
      valueInputOption: 'RAW',
      data: TABS.map((t) => ({
        range: `${quote(t.title)}!A1:${colLetter(t.headers.length - 1)}1`,
        values: [t.headers],
      })),
    },
  });
  console.log('Header rows written.');

  for (const r of realign) {
    const t = TABS.find((x) => x.title === r.title)!;
    await sheets.spreadsheets.values.clear({
      spreadsheetId: id,
      range: `${quote(r.title)}!A2:ZZ`,
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: id,
      range: `${quote(r.title)}!A2:${colLetter(t.headers.length - 1)}${r.rows.length + 1}`,
      valueInputOption: 'RAW',
      requestBody: { values: r.rows },
    });
    console.log(
      `  ${r.title}: ${r.rows.length} row(s) rewritten under the new column order.`,
    );
  }

  // ── 4. Migrate request + approval data onto the new columns ───────────────
  if (oldRequests) {
    const legsByReq = groupBy(snapshot.RequestLegs || [], (r) => r.RequestID);
    const teamByReq = groupBy(snapshot.TeamMembers || [], (r) => r.RequestID);
    const payByReq = groupBy(snapshot.Payments || [], (r) => r.RequestID);
    const advByReq = groupBy(snapshot.Advances || [], (r) => r.RequestID);
    const headers = TABS.find((t) => t.title === 'Requests')!.headers;

    const rows = snapshot.Requests.map((r) => {
      const pay = payByReq[r.RequestID]?.[0];
      const adv = advByReq[r.RequestID]?.[0];
      const merged: Rec = {
        ...r,
        TeamMembers: (teamByReq[r.RequestID] || [])
          .map((m) =>
            [m.EmployeeID, m.Name, m.Department, m.Designation, m.Band].join(
              ' | ',
            ),
          )
          .join('\n'),
        Trips: (legsByReq[r.RequestID] || [])
          .map((l) =>
            [
              l.TravelDate,
              l.Mode,
              l.TravelFrom,
              l.TravelTo,
              l.Amount,
              l.Note,
            ].join(' | '),
          )
          .join('\n'),
        DocumentTypes: '',
        DocumentLinks: '',
        AdvanceApproved: nn(adv?.AmountApproved) || nn(r.AdvanceApprovedAmount),
        SettlementDueDate: nn(adv?.SettlementDueDate),
        SettledAmount: nn(adv?.SettledAmount),
        SettledAt: nn(adv?.SettledAt),
        PaymentMode: nn(pay?.PaymentMode),
        TransactionID: nn(pay?.TransactionID),
        PaymentDate: nn(pay?.PaymentDate),
        PaidAmount: nn(pay?.Amount),
        PaidBy: nn(pay?.ProcessedBy),
      };
      return headers.map((h) => nn(merged[h]));
    });

    await sheets.spreadsheets.values.clear({
      spreadsheetId: id,
      range: `'Requests'!A2:ZZ`,
    });
    if (rows.length) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: id,
        range: `'Requests'!A2:${colLetter(headers.length - 1)}${rows.length + 1}`,
        valueInputOption: 'RAW',
        requestBody: { values: rows },
      });
    }
    console.log(
      `Migrated ${rows.length} request row(s) — trips, team, payment and advance folded in.`,
    );
  }

  if (oldApprovals) {
    // Collapse the append-only approval log into one row per request.
    const STAGE_GROUP: Record<string, string> = {
      manager_review: 'Manager',
      admin_review: 'Admin',
      finance_review: 'Finance',
      payment_processing: 'Payment',
    };
    // The old log stored the verb ("Approve"); the column layout stores the
    // resulting state ("Approved"), which is what the UI matches on.
    const STATE: Record<string, string> = {
      Approve: 'Approved',
      Approved: 'Approved',
      Reject: 'Rejected',
      Rejected: 'Rejected',
      Return: 'Returned',
      Returned: 'Returned',
      Paid: 'Paid',
      'Documents Requested': 'Documents Requested',
    };
    const byReq = groupBy(snapshot.Approvals, (r) => r.RequestID);
    const nameOf = Object.fromEntries(
      (snapshot.Requests || []).map((r) => [r.RequestID, r.EmployeeName]),
    );
    const headers = TABS.find((t) => t.title === 'Approvals')!.headers;

    const rows = Object.entries(byReq).map(([requestId, entries]) => {
      const rec: Rec = {
        RequestID: requestId,
        EmployeeName: nn(nameOf[requestId]),
      };
      entries
        .slice()
        .sort((a, b) => nn(a.Timestamp).localeCompare(nn(b.Timestamp)))
        .forEach((e) => {
          const who = `${nn(e.ActorName)} <${nn(e.ActorEmail)}>`;
          if (e.Stage === 'submitted') {
            rec.SubmittedAt = nn(e.Timestamp);
            rec.SubmittedRemarks = nn(e.Remarks);
          } else {
            const g = STAGE_GROUP[e.Stage];
            if (g) {
              rec[`${g}Status`] = STATE[nn(e.Action)] || nn(e.Action);
              rec[`${g}By`] = who;
              rec[`${g}At`] = nn(e.Timestamp);
              rec[`${g}Remarks`] = nn(e.Remarks);
            }
          }
          rec.LastAction = `${nn(e.Action)} by ${nn(e.ActorName)}`;
          rec.LastActionAt = nn(e.Timestamp);
        });
      const req = (snapshot.Requests || []).find(
        (r) => r.RequestID === requestId,
      );
      rec.CurrentStage = nn(req?.Status);
      return headers.map((h) => nn(rec[h]));
    });

    await sheets.spreadsheets.values.clear({
      spreadsheetId: id,
      range: `'Approvals'!A2:ZZ`,
    });
    if (rows.length) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: id,
        range: `'Approvals'!A2:${colLetter(headers.length - 1)}${rows.length + 1}`,
        valueInputOption: 'RAW',
        requestBody: { values: rows },
      });
    }
    console.log(
      `Collapsed the approval log into ${rows.length} row(s) — one per request.`,
    );
  }

  // ── 5. Seed reference data into empty tabs only ───────────────────────────
  const seedable = TABS.filter((t) => t.seed?.length);
  // Look at the whole data block, not just column A. Column A can legitimately
  // be empty — auth_id is blank until someone signs in — and treating that as
  // "tab is empty" would re-seed over real rows.
  const current = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: id,
    ranges: seedable.map(
      (t) => `${quote(t.title)}!A2:${colLetter(t.headers.length - 1)}`,
    ),
  });
  const toSeed = seedable.filter((_, i) => {
    const rows = (current.data.valueRanges?.[i].values || []) as unknown[][];
    return !rows.some((r) =>
      r?.some((c) => c !== '' && c !== null && c !== undefined),
    );
  });
  if (toSeed.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: id,
      requestBody: {
        valueInputOption: 'RAW',
        data: toSeed.map((t) => ({
          range: `${quote(t.title)}!A2:${colLetter(t.headers.length - 1)}${t.seed!.length + 1}`,
          values: t.seed!,
        })),
      },
    });
    console.log(
      `Seeded: ${toSeed.map((t) => `${t.title} (${t.seed!.length})`).join(', ')}`,
    );
  }

  // ── 5b. Top up reference tabs with entries added since they were seeded ──
  // Seeding only fills an empty tab, so a setting or dropdown value introduced
  // in a later release would otherwise never reach a live sheet — the dropdown
  // comes up blank, or the setting cannot be changed because there is no row to
  // change. Only entries missing outright are appended, at the end: existing
  // rows keep their order and any edits, and something switched off is left off
  // rather than resurrected.
  const topUp: {
    title: string;
    key: (r: unknown[]) => string;
    label: (r: unknown[]) => string;
  }[] = [
    // A setting is identified by its key; a list value by which list it is in.
    {
      title: 'Config',
      key: (r) => String(r[0] ?? '').trim(),
      label: (r) => String(r[0]),
    },
    {
      title: 'Lists',
      key: (r) => `${String(r[0] ?? '').trim()} ${String(r[1] ?? '').trim()}`,
      label: (r) => String(r[0]),
    },
  ];
  for (const { title, key, label } of topUp) {
    const tab = TABS.find((t) => t.title === title);
    if (!tab?.seed?.length || toSeed.includes(tab)) continue;
    const range = `${quote(tab.title)}!A2:${colLetter(tab.headers.length - 1)}`;
    const existing = ((
      await sheets.spreadsheets.values.get({ spreadsheetId: id, range })
    ).data.values || []) as unknown[][];
    const have = new Set(existing.map(key));
    const missing = tab.seed.filter((r) => !have.has(key(r)));
    if (!missing.length) continue;
    await sheets.spreadsheets.values.append({
      spreadsheetId: id,
      range,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: missing },
    });
    console.log(
      `  ${title}: added ${missing.length} missing entr(y/ies) — ${[...new Set(missing.map(label))].join(', ')}`,
    );
  }

  // ── 6. Formatting ─────────────────────────────────────────────────────────
  const fmt: object[] = [];
  for (const t of TABS) {
    const sheetId = existing.get(t.title)!;
    fmt.push({
      updateSheetProperties: {
        properties: {
          sheetId,
          gridProperties: { frozenRowCount: 1 },
          tabColor: t.color,
        },
        fields: 'gridProperties.frozenRowCount,tabColor',
      },
    });
    fmt.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: t.headers.length,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: t.color,
            horizontalAlignment: 'LEFT',
            verticalAlignment: 'MIDDLE',
            wrapStrategy: 'CLIP',
            textFormat: {
              bold: true,
              fontSize: 10,
              foregroundColor: { red: 1, green: 1, blue: 1 },
            },
          },
        },
        fields:
          'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)',
      },
    });
    // Trips / TeamMembers / DocumentLinks hold several lines in one cell.
    fmt.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: t.headers.length,
        },
        cell: {
          userEnteredFormat: { verticalAlignment: 'TOP', wrapStrategy: 'CLIP' },
        },
        fields: 'userEnteredFormat(verticalAlignment,wrapStrategy)',
      },
    });
    (t.widths || []).forEach((px, i) => {
      fmt.push({
        updateDimensionProperties: {
          range: {
            sheetId,
            dimension: 'COLUMNS',
            startIndex: i,
            endIndex: i + 1,
          },
          properties: { pixelSize: px },
          fields: 'pixelSize',
        },
      });
    });
    fmt.push({
      setBasicFilter: {
        filter: {
          range: {
            sheetId,
            startRowIndex: 0,
            startColumnIndex: 0,
            endColumnIndex: t.headers.length,
          },
        },
      },
    });
  }
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: id,
    requestBody: { requests: fmt },
  });
  console.log('Formatting applied.');

  // ── 7. Remove tabs the new layout folded away ─────────────────────────────
  const removable = [...OBSOLETE_TABS, 'Sheet1'].filter((t) => existing.has(t));
  if (removable.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: id,
      requestBody: {
        requests: removable.map((t) => ({
          deleteSheet: { sheetId: existing.get(t)! },
        })),
      },
    });
    console.log(`Removed folded-away tab(s): ${removable.join(', ')}`);
  }

  console.log(`\n${TABS.length} tabs: ${TABS.map((t) => t.title).join(', ')}`);
  console.log(`https://docs.google.com/spreadsheets/d/${id}/edit`);
}

function groupBy<T>(rows: T[], key: (r: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const r of rows) (out[key(r)] ||= []).push(r);
  return out;
}

main().catch((err) => {
  console.error('\nSetup failed:', err.message);
  process.exit(1);
});
