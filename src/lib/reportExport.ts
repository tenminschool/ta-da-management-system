import type { RequestListItem } from "../api.js";
import { STATUS_LABEL, type Status } from "../../shared/types.js";

/**
 * The dashboard report as a file: a laid-out PDF and a CSV, both built from exactly the claims the
 * dashboard filters currently leave on screen.
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

interface Group { name: string; count: number; claimed: number; approved: number; paid: number }

function groupBy(claims: RequestListItem[], key: (r: RequestListItem) => string): Group[] {
  const by = new Map<string, Group>();
  for (const r of claims) {
    const k = key(r) || "Unassigned";
    const g = by.get(k) || { name: k, count: 0, claimed: 0, approved: 0, paid: 0 };
    g.count += 1;
    g.claimed += r.totalClaim;
    g.approved += r.approvedAmount > 0 ? r.approvedAmount : 0;
    g.paid += paidOf(r);
    by.set(k, g);
  }
  return [...by.values()].sort((a, b) => b.claimed - a.claimed);
}

/** Everything the two files show, worked out once. */
export function summarise(input: ReportInput) {
  const { claims } = input;
  const claimed = claims.reduce((s, r) => s + r.totalClaim, 0);
  const disbursed = claims.reduce((s, r) => s + paidOf(r), 0);
  const adjusted = claims.filter((r) => r.approvedAmount > 0).reduce((s, r) => s + (r.totalClaim - r.approvedAmount), 0);
  const paidCount = claims.filter((r) => PAID.includes(r.status)).length;
  const statusOrder = Object.keys(STATUS_LABEL);
  const byStatus = groupBy(claims, (r) => r.status)
    .map((g) => ({ ...g, name: statusLabel(g.name) }))
    .sort((a, b) => statusOrder.findIndex((s) => STATUS_LABEL[s as Status] === a.name) - statusOrder.findIndex((s) => STATUS_LABEL[s as Status] === b.name));
  return {
    totals: { count: claims.length, claimed, disbursed, adjusted, paidCount, awaiting: claims.length - paidCount },
    byStatus,
    byDepartment: groupBy(claims, (r) => r.department),
    byScope: groupBy(claims, (r) => (r.scope === "outside" ? "Outside city" : "Inside city")),
    topPeople: groupBy(claims, (r) => `${r.employeeName} (${r.employeeId})`).slice(0, 10),
  };
}

const claimRow = (r: RequestListItem, input: ReportInput) => [
  r.requestId,
  r.employeeName,
  r.employeeId,
  r.department || "",
  r.scope === "outside" ? "Outside city" : "Inside city",
  r.travelType === "team" ? "Team" : r.groupId ? "Team member" : "Individual",
  day(r.submittedAt || r.createdAt),
  day(r.fromDate) + (r.toDate && r.toDate !== r.fromDate ? ` to ${day(r.toDate)}` : ""),
  statusLabel(r.status),
  r.totalClaim,
  r.approvedAmount > 0 ? r.approvedAmount : "",
  PAID.includes(r.status) ? paidOf(r) : "",
  day(r.paymentDate),
  input.dateOf(r) || "",
];

const CLAIM_HEADERS = [
  "Request", "Employee", "Employee ID", "Department", "Type", "Travel", "Submitted", "Travel date",
  "Status", "Claimed", "Approved", "Paid", "Payment date",
];

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

/** The summary report as CSV: report details, totals, the breakdowns, then every claim. */
export function downloadCsv(input: ReportInput) {
  const s = summarise(input);
  const cell = (v: unknown) => {
    const t = String(v ?? "");
    // A leading =, +, - or @ would be run as a formula by a spreadsheet.
    const safe = /^[=+\-@]/.test(t) && Number.isNaN(Number(t)) ? `'${t}` : t;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const lines: unknown[][] = [];
  const blank = () => lines.push([]);
  lines.push(["TA & Per-Diem report"]);
  lines.push(["Generated", new Date().toLocaleString(), "by", input.generatedBy]);
  for (const [k, v] of input.filters) lines.push([k, v]);
  blank();
  lines.push(["SUMMARY"]);
  lines.push(["Total requests", s.totals.count]);
  lines.push([`Total claimed (${input.currency})`, s.totals.claimed]);
  lines.push([`Total disbursed (${input.currency})`, s.totals.disbursed]);
  lines.push([`Total adjusted (${input.currency})`, s.totals.adjusted]);
  lines.push(["Paid claims", s.totals.paidCount]);
  lines.push(["Not yet paid", s.totals.awaiting]);
  const group = (title: string, first: string, g: Group[]) => {
    blank();
    lines.push([title]);
    lines.push([first, "Claims", `Claimed (${input.currency})`, `Approved (${input.currency})`, `Paid (${input.currency})`]);
    g.forEach((x) => lines.push([x.name, x.count, x.claimed, x.approved, x.paid]));
  };
  group("BY STATUS", "Status", s.byStatus);
  group("BY DEPARTMENT", "Department", s.byDepartment);
  group("BY TRAVEL TYPE", "Type", s.byScope);
  group("TOP 10 PEOPLE BY CLAIM VALUE", "Employee", s.topPeople);
  blank();
  lines.push(["CLAIMS"]);
  lines.push(CLAIM_HEADERS.map((h) => (["Claimed", "Approved", "Paid"].includes(h) ? `${h} (${input.currency})` : h)));
  input.claims.forEach((r) => lines.push(claimRow(r, input).slice(0, CLAIM_HEADERS.length)));
  // A byte-order mark so Excel reads the file as UTF-8 and keeps non-English names intact.
  const text = "﻿" + lines.map((row) => row.map(cell).join(",")).join("\r\n");
  save(new Blob([text], { type: "text/csv;charset=utf-8" }), `ta-per-diem-report-${stamp()}.csv`);
}

/** The report as a PDF: heading, filters, figures, the breakdowns, then every claim. */
export async function downloadPdf(input: ReportInput) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const s = summarise(input);
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 36;
  const cur = input.currency;
  const ink: [number, number, number] = [23, 23, 23];
  const muted: [number, number, number] = [100, 116, 139];
  const brand: [number, number, number] = [234, 72, 8];

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
  doc.setFillColor(...brand);
  doc.rect(0, 64, W, 3, "F");

  // ── Filters
  let y = 90;
  doc.setTextColor(...ink);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Report filters", M, y);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...muted);
  y += 14;
  input.filters.forEach(([k, v]) => {
    doc.text(`${k}: ${v}`, M, y);
    y += 12;
  });

  // ── Figures
  y += 8;
  const cards: [string, string][] = [
    ["Total requests", String(s.totals.count)],
    ["Total claimed", `${cur} ${num(s.totals.claimed)}`],
    ["Total disbursed", `${cur} ${num(s.totals.disbursed)}`],
    ["Total adjusted", `${cur} ${num(s.totals.adjusted)}`],
    ["Paid / not yet paid", `${s.totals.paidCount} / ${s.totals.awaiting}`],
  ];
  const gap = 10;
  const cw = (W - 2 * M - gap * (cards.length - 1)) / cards.length;
  cards.forEach(([label, value], i) => {
    const x = M + i * (cw + gap);
    doc.setDrawColor(226, 232, 240);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(x, y, cw, 52, 5, 5, "FD");
    doc.setTextColor(...muted);
    doc.setFontSize(8.5);
    doc.text(label.toUpperCase(), x + 10, y + 17);
    doc.setTextColor(...ink);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(value, x + 10, y + 38);
    doc.setFont("helvetica", "normal");
  });
  y += 52 + 22;

  const head = { fillColor: ink, textColor: [255, 255, 255] as [number, number, number], fontStyle: "bold" as const, fontSize: 8.5 };
  const section = (title: string, startY: number) => {
    doc.setTextColor(...ink);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(title, M, startY);
    doc.setFont("helvetica", "normal");
    return startY + 8;
  };
  const lastY = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  const groupTable = (title: string, first: string, g: Group[]) => {
    if (y > H - 120) { doc.addPage(); y = 50; }
    autoTable(doc, {
      startY: section(title, y),
      margin: { left: M, right: M },
      head: [[first, "Claims", `Claimed (${cur})`, `Approved (${cur})`, `Paid (${cur})`]],
      body: g.length ? g.map((x) => [x.name, x.count, num(x.claimed), x.approved ? num(x.approved) : "-", x.paid ? num(x.paid) : "-"]) : [["Nothing in this report", "", "", "", ""]],
      styles: { fontSize: 8.5, cellPadding: 4, textColor: ink },
      headStyles: head,
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" } },
    });
    y = lastY() + 22;
  };
  groupTable("Claims by status", "Status", s.byStatus);
  groupTable("Claims by department", "Department", s.byDepartment);
  groupTable("Claims by travel type", "Type", s.byScope);
  groupTable("Top 10 people by claim value", "Employee", s.topPeople);

  // ── Every claim
  doc.addPage();
  y = 50;
  autoTable(doc, {
    startY: section(`All claims in this report (${s.totals.count})`, y),
    margin: { left: M, right: M, bottom: 34 },
    head: [["Request", "Employee", "Department", "Type", "Submitted", "Travel date", "Status", `Claimed (${cur})`, `Approved (${cur})`, `Paid (${cur})`]],
    body: input.claims.length
      ? input.claims.map((r) => {
          const row = claimRow(r, input);
          return [row[0], `${row[1]} (${row[2]})`, row[3], `${row[4]}${row[5] === "Individual" ? "" : ` · ${row[5]}`}`, row[6], row[7], row[8], num(r.totalClaim), row[10] === "" ? "-" : num(Number(row[10])), row[11] === "" ? "-" : num(Number(row[11]))] as string[];
        })
      : [["Nothing matches these filters", "", "", "", "", "", "", "", "", ""]],
    styles: { fontSize: 7.5, cellPadding: 3.5, textColor: ink, overflow: "linebreak" },
    headStyles: { ...head, fontSize: 7.5 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: { 0: { cellWidth: 82 }, 7: { halign: "right" }, 8: { halign: "right" }, 9: { halign: "right" } },
    showHead: "everyPage",
    foot: [["", "", "", "", "", "", "Total", num(s.totals.claimed), "", num(s.totals.disbursed)]],
    footStyles: { fillColor: [241, 245, 249], textColor: ink, fontStyle: "bold", halign: "right" },
  });

  // ── Page numbers, once the page count is known
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFontSize(8);
    doc.setTextColor(...muted);
    doc.text("TA & Per-Diem Management System", M, H - 16);
    doc.text(`Page ${p} of ${pages}`, W - M, H - 16, { align: "right" });
  }

  save(doc.output("blob"), `ta-per-diem-report-${stamp()}.pdf`);
}
