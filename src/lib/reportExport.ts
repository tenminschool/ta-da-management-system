import type { RequestListItem } from "../api.js";
import { STATUS_LABEL, type Status } from "../../shared/types.js";

/**
 * The dashboard report as files: a multi-sheet Excel workbook and a laid-out PDF. Both are built
 * from exactly the claims the dashboard filters currently leave on screen, and both use one colour
 * code for claim status so the two files read the same way.
 */

export interface ReportInput {
  claims: RequestListItem[];
  currency: string;
  generatedBy: string;
  /** Plain-language filters, e.g. [["Counted by", "Submitted"], ["Period", "all time"]]. */
  filters: [string, string][];
  /** The date each claim is counted against, and what that is called. */
  dateLabel: string;
  dateOf: (r: RequestListItem) => string;
}

const PAID = ["paid", "completed"];
const num = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n);
const statusLabel = (s: string) => STATUS_LABEL[s as Status] ?? s.replace(/_/g, " ");
const day = (iso: string) => (iso || "").slice(0, 10);
const paidOf = (r: RequestListItem) => (PAID.includes(r.status) ? r.paidAmount || r.finalPayable : 0);

// ── Colour code ─────────────────────────────────────────────────────────────

/** One colour per kind of claim status: soft fill, strong text, and the solid colour for bars. */
const TONES = {
  grey: { fill: "F1F5F9", text: "475569", solid: "94A3B8" },
  amber: { fill: "FEF3C7", text: "92400E", solid: "F59E0B" },
  orange: { fill: "FFEDD5", text: "9A3412", solid: "F97316" },
  red: { fill: "FEE2E2", text: "991B1B", solid: "EF4444" },
  blue: { fill: "DBEAFE", text: "1E40AF", solid: "3B82F6" },
  green: { fill: "DCFCE7", text: "166534", solid: "22C55E" },
  teal: { fill: "CCFBF1", text: "115E59", solid: "14B8A6" },
  purple: { fill: "EDE9FE", text: "5B21B6", solid: "8B5CF6" },
} as const;
type Tone = keyof typeof TONES;

const STATUS_TONE: Record<string, Tone> = {
  draft: "grey",
  manager_review: "amber",
  admin_review: "amber",
  finance_review: "amber",
  returned: "orange",
  rejected: "red",
  payment_processing: "blue",
  paid: "green",
  completed: "teal",
  payment_disputed: "purple",
};
const toneOf = (status: string) => TONES[STATUS_TONE[status] ?? "grey"];

/** What each colour means, for the legend in both files. */
const LEGEND: [Tone, string][] = [
  ["grey", "Draft — not submitted yet"],
  ["amber", "In review — manager, admin or finance"],
  ["orange", "Returned — sent back for changes"],
  ["red", "Rejected"],
  ["blue", "Approved — payment processing"],
  ["green", "Paid — waiting for the employee to confirm"],
  ["teal", "Completed"],
  ["purple", "Payment not received — disputed"],
];

const BRAND = "EA4808";
const INK = "171717";
const MUTED = "64748B";

// ── Numbers behind both files ───────────────────────────────────────────────

interface Group { key: string; name: string; count: number; claimed: number; approved: number; paid: number }

function groupBy(claims: RequestListItem[], key: (r: RequestListItem) => string, name = (k: string) => k): Group[] {
  const by = new Map<string, Group>();
  for (const r of claims) {
    const k = key(r) || "Unassigned";
    const g = by.get(k) || { key: k, name: name(k), count: 0, claimed: 0, approved: 0, paid: 0 };
    g.count += 1;
    g.claimed += r.totalClaim;
    g.approved += r.approvedAmount > 0 ? r.approvedAmount : 0;
    g.paid += paidOf(r);
    by.set(k, g);
  }
  return [...by.values()].sort((a, b) => b.claimed - a.claimed);
}

export function summarise(input: ReportInput) {
  const { claims } = input;
  const claimed = claims.reduce((s, r) => s + r.totalClaim, 0);
  const disbursed = claims.reduce((s, r) => s + paidOf(r), 0);
  const adjusted = claims.filter((r) => r.approvedAmount > 0).reduce((s, r) => s + (r.totalClaim - r.approvedAmount), 0);
  const paidCount = claims.filter((r) => PAID.includes(r.status)).length;
  const order = Object.keys(STATUS_LABEL);
  return {
    totals: { count: claims.length, claimed, disbursed, adjusted, paidCount, awaiting: claims.length - paidCount },
    byStatus: groupBy(claims, (r) => r.status, statusLabel).sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key)),
    byDepartment: groupBy(claims, (r) => r.department),
    byScope: groupBy(claims, (r) => (r.scope === "outside" ? "Outside city" : "Inside city")),
    topPeople: groupBy(claims, (r) => `${r.employeeName} (${r.employeeId})`).slice(0, 10),
  };
}

const kindOf = (r: RequestListItem) => (r.travelType === "team" ? "Team" : r.groupId ? "Team member" : "Individual");
const scopeOf = (r: RequestListItem) => (r.scope === "outside" ? "Outside city" : "Inside city");
const tripDates = (r: RequestListItem) => day(r.fromDate) + (r.toDate && r.toDate !== r.fromDate ? ` to ${day(r.toDate)}` : "");

function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const stamp = () => new Date().toISOString().slice(0, 10);

// ── Excel ───────────────────────────────────────────────────────────────────

/** The report as a workbook: Summary, By Status, By Department, By Travel Type, Top People, Claims. */
export async function downloadExcel(input: ReportInput) {
  const { default: ExcelJS } = await import("exceljs");
  const s = summarise(input);
  const cur = input.currency;
  const wb = new ExcelJS.Workbook();
  wb.creator = input.generatedBy;
  wb.created = new Date();
  const argb = (hex: string) => `FF${hex}`;
  const fill = (hex: string) => ({ type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: argb(hex) } });
  const thin = { style: "thin" as const, color: { argb: "FFE2E8F0" } };
  const box = { top: thin, left: thin, bottom: thin, right: thin };
  const MONEY = '#,##0;[Red]-#,##0;"-"';

  type Sheet = ReturnType<typeof wb.addWorksheet>;
  const banner = (ws: Sheet, title: string, cols: number, subtitle = "") => {
    ws.mergeCells(1, 1, 1, cols);
    const t = ws.getCell(1, 1);
    t.value = title;
    t.font = { name: "Calibri", size: 16, bold: true, color: { argb: "FFFFFFFF" } };
    t.fill = fill(INK);
    t.alignment = { vertical: "middle", indent: 1 };
    ws.getRow(1).height = 30;
    ws.mergeCells(2, 1, 2, cols);
    const sub = ws.getCell(2, 1);
    sub.value = subtitle || `Generated ${new Date().toLocaleString()} by ${input.generatedBy}`;
    sub.font = { size: 9, italic: true, color: { argb: argb(MUTED) } };
    sub.fill = fill("F8FAFC");
    sub.alignment = { indent: 1 };
    for (let c = 1; c <= cols; c++) ws.getCell(3, c).fill = fill(BRAND);
    ws.getRow(3).height = 3;
  };
  const headerRow = (ws: Sheet, rowNo: number, labels: string[]) => {
    const row = ws.getRow(rowNo);
    labels.forEach((l, i) => {
      const c = row.getCell(i + 1);
      c.value = l;
      c.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
      c.fill = fill("334155");
      c.alignment = { vertical: "middle", horizontal: i === 0 ? "left" : /\(/.test(l) || l === "Claims" ? "right" : "left", wrapText: true };
      c.border = box;
    });
    row.height = 22;
  };
  const statusCell = (c: { fill: unknown; font: unknown; alignment: unknown }, status: string) => {
    const t = toneOf(status);
    c.fill = fill(t.fill) as never;
    c.font = { bold: true, color: { argb: argb(t.text) }, size: 10 } as never;
    c.alignment = { horizontal: "center", vertical: "middle" } as never;
  };

  // ── Summary
  const ws0 = wb.addWorksheet("Summary", { properties: { tabColor: { argb: argb(BRAND) } }, views: [{ showGridLines: false }] });
  ws0.columns = [{ width: 30 }, { width: 22 }, { width: 22 }, { width: 22 }, { width: 22 }, { width: 22 }];
  banner(ws0, "TA & Per-Diem Report", 6);
  let r = 5;
  ws0.getCell(r, 1).value = "REPORT FILTERS";
  ws0.getCell(r, 1).font = { bold: true, size: 10, color: { argb: argb(MUTED) } };
  r += 1;
  input.filters.forEach(([k, v]) => {
    ws0.getCell(r, 1).value = k;
    ws0.getCell(r, 1).font = { bold: true, size: 10 };
    ws0.mergeCells(r, 2, r, 6);
    ws0.getCell(r, 2).value = v;
    r += 1;
  });
  r += 1;
  const tiles: [string, string | number, Tone | "ink", string][] = [
    ["Total requests", s.totals.count, "ink", "0"],
    [`Total claimed (${cur})`, s.totals.claimed, "blue", "#,##0"],
    [`Total disbursed (${cur})`, s.totals.disbursed, "green", "#,##0"],
    [`Total adjusted (${cur})`, s.totals.adjusted, "amber", "#,##0"],
    ["Paid claims", s.totals.paidCount, "teal", "0"],
    ["Not yet paid", s.totals.awaiting, "purple", "0"],
  ];
  tiles.forEach(([label, value, tone, fmt], i) => {
    const t = tone === "ink" ? { fill: "F1F5F9", text: INK, solid: INK } : TONES[tone];
    const l = ws0.getCell(r, i + 1);
    l.value = label;
    l.font = { size: 9, bold: true, color: { argb: argb(t.text) } };
    l.fill = fill(t.fill);
    l.alignment = { indent: 1, vertical: "middle" };
    l.border = { top: { style: "medium", color: { argb: argb(t.solid) } } };
    const v = ws0.getCell(r + 1, i + 1);
    v.value = value;
    v.numFmt = fmt;
    v.font = { size: 18, bold: true, color: { argb: argb(t.text) } };
    v.fill = fill(t.fill);
    v.alignment = { indent: 1, vertical: "middle", horizontal: "left" };
  });
  ws0.getRow(r + 1).height = 30;
  r += 4;
  ws0.getCell(r, 1).value = "COLOUR CODE";
  ws0.getCell(r, 1).font = { bold: true, size: 10, color: { argb: argb(MUTED) } };
  r += 1;
  LEGEND.forEach(([tone, text]) => {
    const sw = ws0.getCell(r, 1);
    sw.value = text;
    sw.fill = fill(TONES[tone].fill);
    sw.font = { bold: true, size: 10, color: { argb: argb(TONES[tone].text) } };
    sw.border = { left: { style: "thick", color: { argb: argb(TONES[tone].solid) } } };
    sw.alignment = { indent: 1 };
    ws0.mergeCells(r, 1, r, 3);
    r += 1;
  });
  r += 1;
  ws0.getCell(r, 1).value = "Sheets in this workbook: By Status · By Department · By Travel Type · Top People · Claims (every claim, filterable).";
  ws0.getCell(r, 1).font = { size: 9, italic: true, color: { argb: argb(MUTED) } };

  // ── The four summary tables
  const groupSheet = (name: string, first: string, g: Group[], tone: string, colourByStatus: boolean) => {
    const ws = wb.addWorksheet(name, { properties: { tabColor: { argb: argb(tone) } }, views: [{ state: "frozen", ySplit: 4, showGridLines: false }] });
    ws.columns = [{ width: 34 }, { width: 10 }, { width: 18 }, { width: 18 }, { width: 18 }];
    banner(ws, name, 5, `${s.totals.count} claim(s) · ${input.filters.map(([k, v]) => `${k}: ${v}`).join(" · ")}`);
    headerRow(ws, 4, [first, "Claims", `Claimed (${cur})`, `Approved (${cur})`, `Paid (${cur})`]);
    g.forEach((x, i) => {
      const row = ws.getRow(5 + i);
      row.values = [x.name, x.count, x.claimed, x.approved || null, x.paid || null];
      row.eachCell((c, n) => {
        c.border = box;
        if (i % 2) c.fill = fill("F8FAFC");
        if (n >= 3) c.numFmt = MONEY;
        if (n >= 2) c.alignment = { horizontal: "right" };
      });
      if (colourByStatus) statusCell(row.getCell(1), x.key);
      row.getCell(4).font = { color: { argb: argb(TONES.amber.text) } };
      row.getCell(5).font = { color: { argb: argb(TONES.green.text) } };
    });
    const end = 4 + g.length;
    const tot = ws.getRow(end + 1);
    tot.values = ["Total", { formula: `SUM(B5:B${end})`, result: g.reduce((a, x) => a + x.count, 0) }, { formula: `SUM(C5:C${end})`, result: g.reduce((a, x) => a + x.claimed, 0) }, { formula: `SUM(D5:D${end})`, result: g.reduce((a, x) => a + x.approved, 0) }, { formula: `SUM(E5:E${end})`, result: g.reduce((a, x) => a + x.paid, 0) }];
    tot.eachCell((c, n) => {
      c.font = { bold: true };
      c.fill = fill("E2E8F0");
      c.border = box;
      if (n >= 3) c.numFmt = MONEY;
      if (n >= 2) c.alignment = { horizontal: "right" };
    });
    if (g.length) {
      // A bar in each Claimed cell, sized against the biggest, so the biggest stand out at a glance.
      ws.addConditionalFormatting({
        ref: `C5:C${end}`,
        rules: [{ type: "dataBar", priority: 1, minLength: 0, maxLength: 100, gradient: false, border: false, cfvo: [{ type: "min" }, { type: "max" }], color: { argb: argb("93C5FD") } } as never],
      });
    }
  };
  groupSheet("By Status", "Status", s.byStatus, "F59E0B", true);
  groupSheet("By Department", "Department", s.byDepartment, "3B82F6", false);
  groupSheet("By Travel Type", "Type", s.byScope, "14B8A6", false);
  groupSheet("Top People", "Employee", s.topPeople, "8B5CF6", false);

  // ── Every claim
  const wc = wb.addWorksheet("Claims", { properties: { tabColor: { argb: argb(INK) } }, views: [{ state: "frozen", ySplit: 4, xSplit: 1, showGridLines: false }] });
  const heads = ["Request", "Employee", "Employee ID", "Department", "Type", "Travel", input.dateLabel, "Trip dates", "Status", `Claimed (${cur})`, `Approved (${cur})`, `Paid (${cur})`, "Payment date"];
  wc.columns = [{ width: 18 }, { width: 24 }, { width: 13 }, { width: 22 }, { width: 14 }, { width: 13 }, { width: 14 }, { width: 24 }, { width: 24 }, { width: 15 }, { width: 15 }, { width: 15 }, { width: 14 }];
  banner(wc, "All claims in this report", heads.length, `${s.totals.count} claim(s) · ${input.filters.map(([k, v]) => `${k}: ${v}`).join(" · ")}`);
  headerRow(wc, 4, heads);
  input.claims.forEach((c, i) => {
    const row = wc.getRow(5 + i);
    row.values = [c.requestId, c.employeeName, c.employeeId, c.department || "", scopeOf(c), kindOf(c), input.dateOf(c) || "", tripDates(c), statusLabel(c.status), c.totalClaim, c.approvedAmount > 0 ? c.approvedAmount : null, PAID.includes(c.status) ? paidOf(c) : null, day(c.paymentDate)];
    row.eachCell({ includeEmpty: true }, (cell, n) => {
      cell.border = box;
      if (i % 2) cell.fill = fill("F8FAFC");
      if (n >= 10 && n <= 12) cell.numFmt = MONEY;
    });
    row.getCell(1).font = { name: "Consolas", size: 10 };
    statusCell(row.getCell(9), c.status);
    row.getCell(11).font = { color: { argb: argb(TONES.amber.text) } };
    row.getCell(12).font = { bold: true, color: { argb: argb(TONES.green.text) } };
  });
  const last = 4 + input.claims.length;
  if (input.claims.length) {
    wc.autoFilter = { from: { row: 4, column: 1 }, to: { row: last, column: heads.length } };
    const tot = wc.getRow(last + 1);
    tot.getCell(9).value = "Total";
    tot.getCell(10).value = { formula: `SUBTOTAL(109,J5:J${last})`, result: s.totals.claimed };
    tot.getCell(11).value = { formula: `SUBTOTAL(109,K5:K${last})`, result: input.claims.reduce((a, c) => a + (c.approvedAmount > 0 ? c.approvedAmount : 0), 0) };
    tot.getCell(12).value = { formula: `SUBTOTAL(109,L5:L${last})`, result: s.totals.disbursed };
    for (let n = 1; n <= heads.length; n++) {
      const c = tot.getCell(n);
      c.fill = fill("E2E8F0");
      c.font = { bold: true };
      c.border = box;
      if (n >= 10 && n <= 12) c.numFmt = MONEY;
      if (n === 9) c.alignment = { horizontal: "right" };
    }
  }
  wc.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  // Printing any sheet gives one landscape page across, not columns spilling onto extra pages.
  wb.eachSheet((ws) => { ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 }; });

  const buffer = await wb.xlsx.writeBuffer();
  save(
    new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `ta-per-diem-report-${stamp()}.xlsx`,
  );
}

// ── PDF ─────────────────────────────────────────────────────────────────────

const rgb = (hex: string): [number, number, number] => [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];

/** The report as a PDF: figures, charts, the breakdowns, then every claim with status colours. */
export async function downloadPdf(input: ReportInput) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const s = summarise(input);
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 36;
  const cur = input.currency;
  const ink = rgb(INK);
  const muted = rgb(MUTED);

  // ── Title band
  doc.setFillColor(...ink);
  doc.rect(0, 0, W, 64, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("TA & Per-Diem Report", M, 30);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`Generated ${new Date().toLocaleString()} by ${input.generatedBy}`, M, 48);
  doc.setFillColor(...rgb(BRAND));
  doc.rect(0, 64, W, 3, "F");

  // ── Filters
  let y = 88;
  doc.setTextColor(...muted);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("REPORT FILTERS", M, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...ink);
  y += 13;
  doc.text(input.filters.map(([k, v]) => `${k}: ${v}`).join("     ·     "), M, y, { maxWidth: W - 2 * M });
  y += 22;

  // ── Figures, each with its own colour
  const cards: [string, string, Tone | "ink"][] = [
    ["Total requests", String(s.totals.count), "ink"],
    ["Total claimed", `${cur} ${num(s.totals.claimed)}`, "blue"],
    ["Total disbursed", `${cur} ${num(s.totals.disbursed)}`, "green"],
    ["Total adjusted", `${cur} ${num(s.totals.adjusted)}`, "amber"],
    ["Paid / not yet paid", `${s.totals.paidCount} / ${s.totals.awaiting}`, "purple"],
  ];
  const gap = 10;
  const cw = (W - 2 * M - gap * (cards.length - 1)) / cards.length;
  cards.forEach(([label, value, tone], i) => {
    const t = tone === "ink" ? { fill: "F1F5F9", text: INK, solid: INK } : TONES[tone];
    const x = M + i * (cw + gap);
    doc.setFillColor(...rgb(t.fill));
    doc.roundedRect(x, y, cw, 56, 5, 5, "F");
    doc.setFillColor(...rgb(t.solid));
    doc.rect(x, y + 3, 4, 50, "F");
    doc.setTextColor(...rgb(t.text));
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text(label.toUpperCase(), x + 14, y + 19);
    doc.setFontSize(14);
    doc.text(value, x + 14, y + 42);
  });
  y += 56 + 22;

  // ── Charts: claimed by status and by department
  const bars = (title: string, x: number, width: number, rows: { label: string; value: number; color: string; note: string }[]) => {
    doc.setTextColor(...ink);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    doc.text(title, x, y);
    const labelW = 120;
    const noteW = 84;
    const barW = width - labelW - noteW;
    const max = Math.max(1, ...rows.map((r) => r.value));
    rows.forEach((row, i) => {
      const ry = y + 14 + i * 19;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(...ink);
      doc.text(doc.splitTextToSize(row.label, labelW - 8)[0], x, ry + 9);
      doc.setFillColor(241, 245, 249);
      doc.rect(x + labelW, ry, barW, 12, "F");
      if (row.value > 0) {
        doc.setFillColor(...rgb(row.color));
        doc.rect(x + labelW, ry, Math.max(2, (row.value / max) * barW), 12, "F");
      }
      doc.setTextColor(...muted);
      doc.text(row.note, x + width, ry + 9, { align: "right" });
    });
    return y + 14 + rows.length * 19;
  };
  const half = (W - 2 * M - 30) / 2;
  const a = bars("Claimed by status", M, half, s.byStatus.map((g) => ({
    label: g.name, value: g.claimed, color: toneOf(g.key).solid, note: `${num(g.claimed)} · ${g.count}`,
  })));
  const b = bars("Claimed by department (top 8)", M + half + 30, half, s.byDepartment.slice(0, 8).map((g) => ({
    label: g.name, value: g.claimed, color: "3B82F6", note: `${num(g.claimed)} · ${g.count}`,
  })));
  y = Math.max(a, b) + 14;

  // ── Colour legend
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...muted);
  doc.text("COLOUR CODE", M, y);
  y += 12;
  const lw = (W - 2 * M) / 4;
  LEGEND.forEach(([tone, text], i) => {
    const lx = M + (i % 4) * lw;
    const ly = y + Math.floor(i / 4) * 16;
    doc.setFillColor(...rgb(TONES[tone].solid));
    doc.roundedRect(lx, ly - 8, 10, 10, 2, 2, "F");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...ink);
    doc.text(text, lx + 16, ly, { maxWidth: lw - 22 });
  });

  // ── Breakdown tables
  doc.addPage();
  y = 50;
  const head = (hex: string) => ({ fillColor: rgb(hex), textColor: [255, 255, 255] as [number, number, number], fontStyle: "bold" as const, fontSize: 8.5 });
  const section = (title: string, hex: string, startY: number) => {
    doc.setFillColor(...rgb(hex));
    doc.rect(M, startY - 9, 4, 13, "F");
    doc.setTextColor(...ink);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(title, M + 10, startY + 1);
    return startY + 10;
  };
  const lastY = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  const groupTable = (title: string, hex: string, first: string, g: Group[], byStatus = false) => {
    if (y > H - 130) { doc.addPage(); y = 50; }
    autoTable(doc, {
      startY: section(title, hex, y),
      margin: { left: M, right: M },
      head: [[first, "Claims", `Claimed (${cur})`, `Approved (${cur})`, `Paid (${cur})`]],
      body: g.length ? g.map((x) => [x.name, x.count, num(x.claimed), x.approved ? num(x.approved) : "-", x.paid ? num(x.paid) : "-"]) : [["Nothing in this report", "", "", "", ""]],
      foot: g.length ? [["Total", g.reduce((n, x) => n + x.count, 0), num(g.reduce((n, x) => n + x.claimed, 0)), num(g.reduce((n, x) => n + x.approved, 0)), num(g.reduce((n, x) => n + x.paid, 0))]] : undefined,
      styles: { fontSize: 8.5, cellPadding: 4, textColor: ink },
      headStyles: head(hex),
      footStyles: { fillColor: [226, 232, 240], textColor: ink, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right", textColor: rgb(TONES.amber.text) }, 4: { halign: "right", textColor: rgb(TONES.green.text) } },
      didParseCell: (d) => {
        if (byStatus && d.section === "body" && d.column.index === 0 && g[d.row.index]) {
          const t = toneOf(g[d.row.index].key);
          d.cell.styles.fillColor = rgb(t.fill);
          d.cell.styles.textColor = rgb(t.text);
          d.cell.styles.fontStyle = "bold";
        }
      },
    });
    y = lastY() + 22;
  };
  groupTable("Claims by status", "F59E0B", "Status", s.byStatus, true);
  groupTable("Claims by department", "3B82F6", "Department", s.byDepartment);
  groupTable("Claims by travel type", "14B8A6", "Type", s.byScope);
  groupTable("Top 10 people by claim value", "8B5CF6", "Employee", s.topPeople);

  // ── Every claim
  doc.addPage();
  y = 50;
  const body = input.claims.map((c) => [
    c.requestId,
    `${c.employeeName} (${c.employeeId})`,
    c.department || "",
    `${scopeOf(c)}${kindOf(c) === "Individual" ? "" : ` · ${kindOf(c)}`}`,
    day(c.submittedAt || c.createdAt),
    tripDates(c),
    statusLabel(c.status),
    num(c.totalClaim),
    c.approvedAmount > 0 ? num(c.approvedAmount) : "-",
    PAID.includes(c.status) ? num(paidOf(c)) : "-",
  ]);
  autoTable(doc, {
    startY: section(`All claims in this report (${s.totals.count})`, INK, y),
    margin: { left: M, right: M, bottom: 34 },
    head: [["Request", "Employee", "Department", "Type", "Submitted", "Trip dates", "Status", `Claimed (${cur})`, `Approved (${cur})`, `Paid (${cur})`]],
    body: body.length ? body : [["Nothing matches these filters", "", "", "", "", "", "", "", "", ""]],
    foot: body.length ? [["", "", "", "", "", "", "Total", num(s.totals.claimed), num(input.claims.reduce((n, c) => n + (c.approvedAmount > 0 ? c.approvedAmount : 0), 0)), num(s.totals.disbursed)]] : undefined,
    styles: { fontSize: 7.5, cellPadding: 3.5, textColor: ink, overflow: "linebreak" },
    headStyles: { ...head("334155"), fontSize: 7.5 },
    footStyles: { fillColor: [226, 232, 240], textColor: ink, fontStyle: "bold", halign: "right" },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: { 0: { cellWidth: 82 }, 7: { halign: "right" }, 8: { halign: "right", textColor: rgb(TONES.amber.text) }, 9: { halign: "right", textColor: rgb(TONES.green.text), fontStyle: "bold" } },
    showHead: "everyPage",
    didParseCell: (d) => {
      if (d.section === "body" && d.column.index === 6 && input.claims[d.row.index]) {
        const t = toneOf(input.claims[d.row.index].status);
        d.cell.styles.fillColor = rgb(t.fill);
        d.cell.styles.textColor = rgb(t.text);
        d.cell.styles.fontStyle = "bold";
        d.cell.styles.halign = "center";
      }
    },
  });

  // ── Page numbers, once the page count is known
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...muted);
    doc.text("TA & Per-Diem Management System", M, H - 16);
    doc.text(`Page ${p} of ${pages}`, W - M, H - 16, { align: "right" });
  }

  save(doc.output("blob"), `ta-per-diem-report-${stamp()}.pdf`);
}
