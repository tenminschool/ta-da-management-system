/**
 * TA & Per-Diem Management System — the API, as a plain Express app.
 *
 * Deliberately knows nothing about how it is served: `server.ts` wraps it with
 * Vite for local development, and `api/index.ts` exports it as a Vercel
 * serverless function. Keeping Vite out of this file keeps it out of the
 * serverless bundle.
 */

import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";
import ExcelJS from "exceljs";

import {
  apiCalls, appendRow, getHeaders, readTab, readTabs, replaceTabRows, resetApiCalls, updateRow,
  withSheetLock, type Row,
} from "./sheets.js";
import { hasRole, signToken, verifyToken, type Session } from "./auth.js";
import { TenMSVerifyError, verifyAccessToken } from "./tenms.js";
import {
  createUploadSession, DRIVE_FOLDER_ID, DriveError, documentFileName, finishUpload, MAX_UPLOAD_BYTES,
} from "./drive.js";
import {
  allEmployees, deptHeadIdFor, fromRequest, fromVehicle, invalidateEmployees, invalidatePolicy, loadPolicy,
  managesOthers, nextRequestId, nowISO, parseLinks, rememberAuthId, STAGE_COLUMN, toApprovalRow,
  toRequest, toVehicle, upsertApproval,
} from "./store.js";
import { addBusinessDays, cfgNum, cfgStr, computeRequest, eligibleModes, money, personalVehicleRateFor } from "../shared/policy.js";
import { STATUS_GROUPS, type StatusGroup } from "../shared/types.js";
import type { RequestDraft, RequestRecord, SessionUser, Status, VehicleRegistration } from "../shared/types.js";

const app = express();
app.use(express.json({ limit: "2mb" }));

// ── Auth plumbing ───────────────────────────────────────────────────────────

interface AuthedRequest extends Request {
  session: Session;
}

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const session = verifyToken(header?.startsWith("Bearer ") ? header.slice(7) : undefined);
  if (!session) {
    res.status(401).json({ error: "Please sign in again." });
    return;
  }
  (req as AuthedRequest).session = session;
  next();
}

/** Wraps an async handler so a rejected promise becomes a 500 instead of a hang. */
function handler(fn: (req: AuthedRequest, res: Response) => Promise<void>) {
  return (req: Request, res: Response) => {
    fn(req as AuthedRequest, res).catch((err: Error) => {
      console.error(`[${req.method} ${req.path}]`, err);
      if (!res.headersSent) res.status(500).json({ error: err.message || "Something went wrong." });
    });
  };
}

// ── Auth ────────────────────────────────────────────────────────────────────

/**
 * Which sign-in methods this deployment offers. Unauthenticated on purpose —
 * the login screen needs it before anyone is signed in.
 */
app.get("/api/auth/methods", handler(async (_req, res) => {
  res.json({
    password: String(process.env.ALLOW_PASSWORD_LOGIN || "").toLowerCase() === "true",
  });
}));

/**
 * Signs a person in from a verified 10 Minute School session.
 *
 * The browser sends the access token it just obtained; we ask the provider who
 * that token belongs to, then match the email against the Employees sheet.
 * Everything about the person — band, department, roles, line manager — comes
 * from the sheet, never from the identity provider.
 */
app.post("/api/auth/tenms", handler(async (req, res) => {
  const accessToken = String(req.body?.accessToken || "");

  let profile;
  try {
    profile = await verifyAccessToken(accessToken);
  } catch (err) {
    const e = err as TenMSVerifyError;
    res.status(e.status || 401).json({ error: e.message });
    return;
  }

  const email = String(profile.email || "").trim().toLowerCase();
  if (!email) {
    res.status(403).json({ error: "Your 10 Minute School account has no email address, so it cannot be matched to an employee record." });
    return;
  }

  const employee = (await allEmployees()).find((e) => e.email.toLowerCase() === email);
  if (!employee) {
    res.status(403).json({
      error: `${email} is not in the Employees sheet. Ask PeopleOps to add you before signing in.`,
    });
    return;
  }
  if (employee.status !== "Active") {
    res.status(403).json({ error: "This account is marked inactive. Contact PeopleOps." });
    return;
  }

  // Record which provider account this person signs in with.
  await rememberAuthId(employee._row, profile.sub);

  const { password: _pw, status: _st, authId: _aid, _row, ...user } = employee;
  res.json({
    token: signToken(user),
    user: { ...user, managesOthers: await managesOthers(user.employeeId) },
  });
}));

/**
 * Password sign-in, kept for local development and first-run setup only.
 * Disabled unless ALLOW_PASSWORD_LOGIN is set, because the sheet stores
 * passwords in plain text — 10 Minute School SSO is the real front door.
 */
app.post("/api/login", handler(async (req, res) => {
  if (String(process.env.ALLOW_PASSWORD_LOGIN || "").toLowerCase() !== "true") {
    res.status(403).json({ error: "Password sign-in is disabled. Use “Login with 10 Minute School”." });
    return;
  }

  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password ?? "");
  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required." });
    return;
  }

  const employee = (await allEmployees()).find(
    (e) => e.email.toLowerCase() === email && e.password === password,
  );
  if (!employee) {
    res.status(401).json({ error: "Wrong email or password." });
    return;
  }
  if (employee.status !== "Active") {
    res.status(403).json({ error: "This account is inactive. Contact PeopleOps." });
    return;
  }

  const { password: _pw, status: _st, authId: _aid, _row, ...user } = employee;
  res.json({
    token: signToken(user),
    user: { ...user, managesOthers: await managesOthers(user.employeeId) },
  });
}));

app.get("/api/me", requireAuth, handler(async (req, res) => {
  const { expiresAt, ...user } = req.session;
  // Recomputed rather than read from the token, so a hierarchy change in the
  // sheet takes effect without the user signing out and back in.
  res.json({ user: { ...user, managesOthers: await managesOthers(user.employeeId) } });
}));

/** Saves this employee's own bKash number, so every future claim starts pre-filled with it. */
app.post("/api/me/bkash", requireAuth, handler(async (req, res) => {
  const bkashNumber = String(req.body?.bkashNumber || "").replace(/[\s-]/g, "");
  if (!/^01[3-9]\d{8}$/.test(bkashNumber)) {
    res.status(400).json({ error: "That does not look like a bKash number — 11 digits starting 01, e.g. 01712345678." });
    return;
  }
  const rows = await readTab("Employees");
  const row = rows.find((r) => r.employee_id === req.session.employeeId);
  if (!row) {
    res.status(404).json({ error: "Your employee record was not found." });
    return;
  }
  const { _row, ...rest } = row;
  await updateRow("Employees", _row, { ...rest, account_number: bkashNumber });
  invalidateEmployees();
  res.json({ ok: true, bkashNumber });
}));

// ── Reference data ──────────────────────────────────────────────────────────

app.get("/api/policy", requireAuth, handler(async (_req, res) => {
  res.json(await loadPolicy());
}));

/** Employee lookup for the team-member picker: search by ID or name. */
app.get("/api/employees", requireAuth, handler(async (req, res) => {
  const q = String(req.query.q || "").trim().toLowerCase();
  const rows = (await allEmployees()).filter((e) => e.status === "Active");
  const matched = q
    ? rows.filter((e) =>
        e.employeeId.toLowerCase().includes(q) ||
        e.name.toLowerCase().includes(q) ||
        e.email.toLowerCase().includes(q))
    : rows;
  res.json({
    employees: matched.slice(0, 25).map((e) => ({
      employeeId: e.employeeId,
      name: e.name,
      email: e.email,
      department: e.department,
      designation: e.designation,
      band: e.band,
      gender: e.gender,
    })),
  });
}));

/** Whether this deployment can accept file uploads at all. */
app.get("/api/uploads/config", requireAuth, handler(async (_req, res) => {
  res.json({ enabled: !!DRIVE_FOLDER_ID, maxBytes: MAX_UPLOAD_BYTES });
}));

/**
 * Step 1 of an upload: open a resumable session and hand the browser a URL to
 * PUT the file to. The bytes go straight from the browser to Google, so a
 * 50 MB file is never limited by this server's request size.
 */
app.post("/api/uploads/session", requireAuth, handler(async (req, res) => {
  const original = String(req.body?.name || "file");
  const mimeType = String(req.body?.mimeType || "application/octet-stream");
  const size = Number(req.body?.size) || 0;
  const index = Number(req.body?.index) || 0;

  const name = documentFileName(req.session.employeeId, req.session.name, original, index);
  try {
    // Pass the caller's origin through so Google allows the browser's PUT.
    res.json(await createUploadSession(name, mimeType, size, req.get("origin") || undefined));
  } catch (err) {
    const e = err as DriveError;
    res.status(e.status || 502).json({ error: e.message });
  }
}));

/** Step 2: the browser reports the new file id; we share it and return the link. */
app.post("/api/uploads/finish", requireAuth, handler(async (req, res) => {
  try {
    res.json({ file: await finishUpload(String(req.body?.fileId || "")) });
  } catch (err) {
    const e = err as DriveError;
    res.status(e.status || 502).json({ error: e.message });
  }
}));

// ── Visibility and stage ownership ──────────────────────────────────────────

/**
 * What a user may see. Employees see their own requests plus anything they are
 * a team member on; approvers additionally see everything at their desk, and
 * Admin/Finance/HR see the whole pipeline for reporting.
 */
function canView(session: Session, req: RequestRecord): boolean {
  if (req.employeeId === session.employeeId) return true;
  if (req.teamMembers.some((m) => m.employeeId === session.employeeId)) return true;
  if (hasRole(session, "admin", "finance", "hr")) return true;
  // Line-manager access is decided by the request's ManagerID — which came from
  // the requester's LineManagerID — not by any role in the sheet.
  if (req.managerId === session.employeeId) return true;
  return false;
}

function canActOn(session: Session, req: RequestRecord): boolean {
  switch (req.status) {
    // A line manager acts only on their own reports; Administration can unblock.
    case "manager_review":
      return req.managerId === session.employeeId || hasRole(session, "admin");
    case "admin_review":
      return hasRole(session, "admin");
    case "finance_review":
    case "payment_processing":
    // The employee says the money never arrived — Finance has to answer that.
    case "payment_disputed":
      return hasRole(session, "finance");
    default:
      return false;
  }
}

/**
 * Request lists are split into two worlds so an approver never sees their own
 * claims mixed in with the ones they are deciding on:
 *   `mine*`  — claims the signed-in person raised
 *   `desk*`  — other people's claims their role is responsible for
 */
app.get("/api/requests", requireAuth, handler(async (req, res) => {
  const tabs = await readTabs(["Requests", "Approvals"]);
  const all = tabs.Requests.map(toRequest);
  const me = req.session.employeeId;
  const myEmail = req.session.email.toLowerCase();
  const visible = all.filter((r) => canView(req.session, r));
  const scope = String(req.query.scope || "all");

  const isMine = (r: RequestRecord) => r.employeeId === me;
  const settled = (r: RequestRecord) => ["payment_processing", "paid", "payment_disputed", "completed"].includes(r.status);

  // Requests this user has personally decided on, read off the Approvals row.
  const actedOn = new Set(
    tabs.Approvals
      .filter((a) => ["manager_by", "admin_by", "finance_by", "payment_by", "advance_hr_by", "advance_dept_head_by"]
        .some((c) => String(a[c] || "").toLowerCase().includes(myEmail)))
      .map((a) => a.request_id),
  );

  const filtered = visible.filter((r) => {
    switch (scope) {
      // The oversight register: literally everything this person may see,
      // their own claims included, so Admin/Finance/HR get a complete list.
      case "everything": return true;
      case "mine": return isMine(r);
      case "mine_advance": return isMine(r) && r.advanceRequested > 0;
      case "mine_payments": return isMine(r) && settled(r);
      case "pending": return canActOn(req.session, r);
      case "processed": return !isMine(r) && actedOn.has(r.requestId);
      case "desk": return !isMine(r);
      case "desk_advance": return !isMine(r) && r.advanceRequested > 0;
      // Finance's own screen: what is waiting on their approval as well as
      // what is waiting to be paid.
      case "desk_payments": return !isMine(r) && (settled(r) || ["finance_review", "payment_disputed"].includes(r.status));
      default: return true;
    }
  });

  const deskRows = visible.filter((r) => !isMine(r));
  const pending = deskRows.filter((r) => canActOn(req.session, r));

  // Whose desk each claim is sitting on, plus the last thing that happened to
  // it — so a register row explains itself without opening the claim.
  const approvalByRequest = new Map(tabs.Approvals.map((a) => [a.request_id, a]));
  const WAITING: Record<string, string> = {
    manager_review: "Line Manager",
    admin_review: "Administration",
    finance_review: "Finance",
    payment_processing: "Finance — payment",
    payment_disputed: "Finance — payment not received",
    paid: "Employee — confirm receipt",
    returned: "Employee — correction needed",
    draft: "Employee — not submitted",
  };
  const decorate = (r: RequestRecord) => {
    const a = approvalByRequest.get(r.requestId);
    return {
      ...r,
      isMine: isMine(r),
      waitingOn: WAITING[r.status] || "",
      lastAction: a?.last_action || "",
      lastActionAt: a?.last_action_at || "",
    };
  };

  res.json({
    requests: filtered
      // Newest first: submitted time when it exists, creation time otherwise.
      .sort((a, b) => (b.submittedAt || b.createdAt || "").localeCompare(a.submittedAt || a.createdAt || ""))
      .map(decorate),
    // Personal cards always describe only the signed-in employee's own claims.
    summary: summarise(all.filter(isMine)),
    inbox: pending.length,
    desk: {
      pending: pending.length,
      pendingValue: pending.reduce((s, r) => s + r.finalPayable, 0),
      processed: deskRows.filter((r) => actedOn.has(r.requestId)).length,
      inFlight: deskRows.filter((r) => ["manager_review", "admin_review", "finance_review"].includes(r.status)).length,
      awaitingPayment: deskRows.filter((r) => r.status === "payment_processing").length,
      advancesOpen: deskRows.filter((r) => r.advanceRequested > 0 && !r.settledAt).length,
      totalValue: deskRows.reduce((s, r) => s + r.totalClaim, 0),
      count: deskRows.length,
    },
  });
}));

function summarise(rows: RequestRecord[]) {
  // Counted from the shared group definitions, so a card's number always
  // matches the list clicking it opens.
  const count = (g: StatusGroup) =>
    rows.filter((r) => (STATUS_GROUPS[g].statuses as readonly Status[]).includes(r.status)).length;
  return {
    pending: count("pending"),
    approved: count("approved"),
    rejected: count("rejected"),
    returned: count("returned"),
    paymentPending: count("paymentPending"),
    paid: count("paid"),
    totalClaims: rows.reduce((s, r) => s + r.totalClaim, 0),
    totalPaid: rows
      .filter((r) => ["paid", "completed"].includes(r.status))
      .reduce((s, r) => s + r.finalPayable, 0),
    count: rows.length,
  };
}

app.get("/api/requests/:id", requireAuth, handler(async (req, res) => {
  const tabs = await readTabs(["Requests", "Approvals"]);
  const row = tabs.Requests.find((r) => r.request_id === req.params.id);
  if (!row) {
    res.status(404).json({ error: "Request not found." });
    return;
  }
  const record = toRequest(row);
  if (!canView(req.session, record)) {
    res.status(403).json({ error: "You do not have access to this request." });
    return;
  }
  const approvalRow = tabs.Approvals.find((a) => a.request_id === record.requestId);

  res.json({
    request: record,
    approval: approvalRow ? toApprovalRow(approvalRow) : null,
    canAct: canActOn(req.session, record),
    canEdit: record.employeeId === req.session.employeeId && ["draft", "returned"].includes(record.status),
    advanceStep: await advanceStepFor(req.session, record),
  });
}));

// ── Payment export (the bKash bulk-disbursement file) ───────────────────────

/**
 * bKash's own bulk-disbursement workbook: Finance fills in Wallet No and
 * Principal Amount on the Client sheet, and every other sheet's formulas
 * (fees, the summary, the final upload format) recalculate from those in
 * Excel. Read once and reused — the template file on disk never changes.
 *
 * This server runs both as plain ESM (`tsx` in dev, and Vercel's function
 * builder) and as an esbuild CJS bundle (the self-hosted build) — and
 * `import.meta.url` comes back empty in that CJS output, so `__dirname` (a
 * real CJS global there) is tried first. The bundle also lands next to
 * Vite's own `dist/assets`, so the self-hosted copy sits in a differently
 * named folder to avoid mixing a server-only file into the public static
 * output — see the "build" script in package.json.
 */
declare const __dirname: string | undefined;
const PAYMENT_TEMPLATE_PATH = typeof __dirname !== "undefined"
  ? path.join(__dirname, "server-assets", "payment-template.xlsx")
  : path.join(path.dirname(fileURLToPath(import.meta.url)), "assets", "payment-template.xlsx");
let paymentTemplateBuffer: Buffer | null = null;
async function paymentTemplate(): Promise<Buffer> {
  if (!paymentTemplateBuffer) paymentTemplateBuffer = await readFile(PAYMENT_TEMPLATE_PATH);
  return paymentTemplateBuffer;
}

app.post("/api/requests/payment-export", requireAuth, handler(async (req, res) => {
  if (!hasRole(req.session, "admin", "finance")) {
    res.status(403).json({ error: "Only Finance or Admin can export a payment file." });
    return;
  }
  const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
  if (!ids.length) {
    res.status(400).json({ error: "Select at least one claim to export." });
    return;
  }

  const rows = await readTab("Requests");
  const byId = new Map(rows.map((r) => [r.request_id, toRequest(r)]));

  // A bank payout has no wallet to disburse to — those, along with anything
  // the caller cannot see, are left out and reported back rather than
  // silently dropped.
  const skipped: string[] = [];
  const payouts: { wallet: string; principal: number }[] = [];
  for (const id of ids) {
    const record = byId.get(id);
    if (!record || !canView(req.session, record) || record.payoutMethod === "bank" || !record.bkashNumber) {
      skipped.push(id);
      continue;
    }
    payouts.push({ wallet: record.bkashNumber, principal: record.approvedAmount > 0 ? record.approvedAmount : record.finalPayable });
  }
  if (!payouts.length) {
    res.status(400).json({ error: "None of the selected claims pay out to a bKash number." });
    return;
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await paymentTemplate());
  // Values were written by us, not by Excel, so nothing is marked dirty —
  // without this the Final/Fee/bKash sheets would open still showing blank.
  workbook.calcProperties.fullCalcOnLoad = true;
  const client = workbook.getWorksheet("Client");
  if (!client) throw new Error("The payment template is missing its Client sheet.");
  payouts.forEach((p, i) => {
    const row = 4 + i;
    client.getCell(`B${row}`).value = p.wallet;
    client.getCell(`C${row}`).value = p.principal;
  });

  const buffer = await workbook.xlsx.writeBuffer();
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="bkash-payment-${nowISO().slice(0, 10)}.xlsx"`);
  if (skipped.length) res.setHeader("X-Skipped-Ids", encodeURIComponent(skipped.join(",")));
  res.send(Buffer.from(buffer));
}));

// ── Live policy preview (no writes) ─────────────────────────────────────────

app.post("/api/requests/preview", requireAuth, handler(async (req, res) => {
  const policy = await loadPolicy();
  const draft = normaliseDraft(req.body?.draft);
  res.json({
    computation: computeRequest(policy, draft, await currentSession(req.session)),
    modes: eligibleModes(policy, {
      band: req.session.band,
      gender: req.session.gender,
      scope: draft.scope,
      travelType: draft.travelType,
      teamSize: draft.travelType === "team" ? draft.teamMembers.length + 1 : 1,
      teamGenders: draft.teamMembers.map((m) => m.gender),
      carSpecialApproval: draft.carSpecialApproval,
    }),
  });
}));

/** Fills in every field so a partial payload from the client can't throw. */
function normaliseDraft(raw: unknown): RequestDraft {
  const d = (raw ?? {}) as Partial<RequestDraft>;
  const n = (v: unknown) => {
    const x = Number(v);
    return Number.isFinite(x) ? x : 0;
  };
  return {
    requestId: d.requestId || "",
    scope: d.scope === "outside" ? "outside" : "inside",
    city: d.city || "",
    claimType: (["ta", "perdiem", "both"].includes(String(d.claimType)) ? d.claimType : "both") as RequestDraft["claimType"],
    travelType: d.travelType === "team" ? "team" : "individual",
    teamMembers: Array.isArray(d.teamMembers) ? d.teamMembers : [],
    fromDate: d.fromDate || "",
    // Left empty rather than falling back to the departure date: an
    // outside-city claim with no return date has to be refused, and silently
    // making it a same-day trip both hid that and paid one day of per-diem.
    toDate: String(d.toDate || ""),
    purpose: d.purpose || "",
    destinationType: d.destinationType || "",
    tripDirection: d.tripDirection === "two_way" ? "two_way" : "one_way",
    route: d.route || "",
    exceptionClaimed: !!d.exceptionClaimed,
    exceptionReason: String(d.exceptionReason || "").trim(),
    advanceWanted: !!d.advanceWanted,
    payoutMethod: d.payoutMethod === "bank" ? "bank" : "bkash",
    bankName: String(d.bankName || "").trim(),
    bankAccountName: String(d.bankAccountName || "").trim(),
    bankAccountNumber: String(d.bankAccountNumber || "").trim(),
    bankRoutingNumber: String(d.bankRoutingNumber || "").trim(),
    bankBranch: String(d.bankBranch || "").trim(),
    destination: d.destination || "",
    startTime: d.startTime || "",
    endTime: d.endTime || "",
    workedAt: d.workedAt || "",
    arrangement: d.arrangement === "company" ? "company" : "self",
    transportMode: d.transportMode || "",
    vehicleType: d.vehicleType || "",
    carSpecialApproval: !!d.carSpecialApproval,
    travelFrom: d.travelFrom || "",
    travelTo: d.travelTo || "",
    totalKM: n(d.totalKM),
    legs: (Array.isArray(d.legs) ? d.legs : []).map((l) => ({
      travelDate: l.travelDate || "",
      mode: l.mode || "",
      travelFrom: l.travelFrom || "",
      travelTo: l.travelTo || "",
      amount: n(l.amount),
      note: l.note || "",
    })),
    officeMealTaken: !!d.officeMealTaken,
    dualWorkstation: !!d.dualWorkstation,
    dualWorkstationType: d.dualWorkstationType || "",
    hotelName: d.hotelName || "",
    checkIn: d.checkIn || "",
    checkOut: d.checkOut || "",
    accommodationAmount: n(d.accommodationAmount),
    rentACarAmount: n(d.rentACarAmount),
    rentACarHeadcount: n(d.rentACarHeadcount),
    flightAmount: n(d.flightAmount),
    otherAmount: n(d.otherAmount),
    otherNote: d.otherNote || "",
    advanceRequested: n(d.advanceRequested),
    bkashNumber: String(d.bkashNumber || "").trim(),
    documentTypes: Array.isArray(d.documentTypes) ? d.documentTypes.filter(Boolean) : [],
    documentLinks: parseLinks(d.documentLinks),
    employeeNote: d.employeeNote || "",
  };
}

/** Builds the full request record from a draft plus the computed amounts. */
function buildRecord(
  draft: RequestDraft,
  computation: ReturnType<typeof computeRequest>,
  session: Session,
  policy: Awaited<ReturnType<typeof loadPolicy>>,
  base: Partial<RequestRecord> & { requestId: string; createdAt: string },
): RequestRecord {
  return {
    requestId: base.requestId,
    createdAt: base.createdAt,
    updatedAt: nowISO(),
    status: base.status ?? "draft",
    employeeId: base.employeeId ?? session.employeeId,
    employeeName: base.employeeName ?? session.name,
    email: base.email ?? session.email,
    band: base.band ?? session.band,
    department: base.department ?? session.department,
    designation: base.designation ?? session.designation,
    scope: draft.scope,
    city: draft.city,
    claimType: computation.claimType,
    travelType: draft.travelType,
    teamSize: draft.travelType === "team" ? draft.teamMembers.length + 1 : 1,
    teamMembers: draft.travelType === "team" ? draft.teamMembers : [],
    fromDate: draft.fromDate,
    toDate: draft.toDate || draft.fromDate,
    tripDays: computation.tripDays,
    purpose: draft.purpose,
    destinationType: draft.destinationType,
    tripDirection: draft.tripDirection,
    route: draft.route,
    exceptionClaimed: draft.exceptionClaimed,
    exceptionReason: draft.exceptionReason,
    advanceWanted: draft.advanceWanted,
    payoutMethod: draft.payoutMethod,
    bankName: draft.bankName,
    bankAccountName: draft.bankAccountName,
    bankAccountNumber: draft.bankAccountNumber,
    bankRoutingNumber: draft.bankRoutingNumber,
    bankBranch: draft.bankBranch,
    destination: draft.destination,
    startTime: draft.startTime,
    endTime: draft.endTime,
    workingHours: computation.workingHours,
    workedAt: draft.workedAt,
    arrangement: draft.arrangement,
    transportMode: draft.transportMode,
    // For a personal-vehicle claim this is the approved registration's type,
    // not whatever the client sent — the client only ever displays it now.
    vehicleType: draft.transportMode === "PersonalVehicle"
      ? (session.registeredVehicle?.vehicleType || draft.vehicleType)
      : draft.vehicleType,
    carSpecialApproval: draft.carSpecialApproval,
    travelFrom: draft.travelFrom,
    travelTo: draft.travelTo,
    totalKM: draft.totalKM,
    fuelRate: draft.transportMode === "PersonalVehicle" ? (personalVehicleRateFor(policy, session) ?? 0) : 0,
    legs: draft.legs,
    taAmount: computation.taAmount,
    perDiemDays: computation.perDiemDays,
    perDiemAmount: computation.perDiemAmount,
    lunchAllowance: computation.lunchAllowance,
    officeMealTaken: draft.dualWorkstation ? true : draft.officeMealTaken,
    dualWorkstation: draft.dualWorkstation,
    dualWorkstationType: draft.dualWorkstationType,
    hotelName: draft.hotelName,
    checkIn: draft.checkIn,
    checkOut: draft.checkOut,
    accommodationAmount: computation.accommodationAmount,
    rentACarAmount: computation.rentACarAmount,
    rentACarHeadcount: draft.rentACarHeadcount,
    flightAmount: computation.flightAmount,
    otherAmount: computation.otherAmount,
    otherNote: draft.otherNote,
    totalClaim: computation.totalClaim,
    advanceRequested: computation.advanceRequested,
    bkashNumber: draft.bkashNumber,
    advanceApproved: base.advanceApproved ?? 0,
    advanceStatus: computation.advanceRequested > 0 ? (base.advanceStatus || "pending") : "",
    settlementDueDate: computation.advanceRequested > 0
      ? addBusinessDays(draft.toDate || draft.fromDate, cfgNum(policy, "ADVANCE_SETTLEMENT_DAYS", 3))
      : "",
    settledAmount: base.settledAmount ?? 0,
    settledAt: base.settledAt ?? "",
    finalPayable: computation.finalPayable,
    managerId: base.managerId ?? "",
    managerEmail: base.managerEmail ?? "",
    submittedAt: base.submittedAt ?? "",
    completedAt: base.completedAt ?? "",
    documentTypes: draft.documentTypes,
    documentLinks: draft.documentLinks,
    policyNotes: computation.notes.join(" | "),
    employeeNote: draft.employeeNote,
    paymentMode: base.paymentMode ?? "",
    transactionId: base.transactionId ?? "",
    paymentDate: base.paymentDate ?? "",
    paidAmount: base.paidAmount ?? 0,
    paidBy: base.paidBy ?? "",
    paymentAck: base.paymentAck ?? "",
    paymentAckAt: base.paymentAckAt ?? "",
    paymentAckNote: base.paymentAckNote ?? "",
    approvedAmount: base.approvedAmount ?? 0,
    approvedAmountBy: base.approvedAmountBy ?? "",
    approvedAmountAt: base.approvedAmountAt ?? "",
    approvedAmountNote: base.approvedAmountNote ?? "",
  };
}


/**
 * Guarantees the request number is unique even across Vercel instances.
 *
 * The in-process lock only orders submissions inside one process; serverless
 * runs many, so two people submitting at the same instant can both read the
 * same highest number. After the row is written we look again: if someone else
 * landed on the same number, whoever holds the later sheet row steps aside and
 * takes a fresh one. Costs one read per submission and nothing else.
 */
async function ensureUniqueRequestId(
  record: RequestRecord,
  rowNumber: number,
  prefix: string,
): Promise<RequestRecord> {
  if (!rowNumber) return record;
  const rows = await readTab("Requests");
  const clashes = rows
    .filter((r) => r.request_id === record.requestId)
    .map((r) => Number(r._row))
    .sort((a, b) => a - b);
  if (clashes.length <= 1 || clashes[0] === rowNumber) return record;

  const year = new Date().getFullYear();
  const highest = rows.reduce((max, r) => {
    const n = Number(String(r.request_id || "").split("-")[2]) || 0;
    return n > max ? n : max;
  }, 0);
  // Each loser offsets by its position, so two of them cannot pick the same one.
  const rank = clashes.indexOf(rowNumber);
  const fixed: RequestRecord = {
    ...record,
    requestId: `${prefix}-${year}-${String(highest + rank).padStart(6, "0")}`,
  };
  await updateRow("Requests", rowNumber, fromRequest(fixed));
  console.warn(`[requests] ${record.requestId} was taken concurrently — reissued as ${fixed.requestId}`);
  return fixed;
}

// ── Create / update a request ───────────────────────────────────────────────

/**
 * Claims still waiting for this person to confirm they were paid.
 *
 * An unanswered claim is how a wrong account number stays invisible, so a new
 * one waits until the last is closed off. Drafts are exempt — only submitting
 * is blocked.
 */
/**
 * The session as the sheet has it right now.
 *
 * A late-claim unlock is granted after the token was signed, so trusting the
 * token would keep the window shut until the person signed in again.
 */
/** This employee's vehicle, if HR or Admin has approved one — never a pending or rejected one. */
async function approvedVehicleFor(employeeId: string): Promise<SessionUser["registeredVehicle"]> {
  const rows = await readTab("Vehicles");
  const row = rows.map(toVehicle).find((v) => v.employeeId === employeeId && v.status === "approved");
  return row
    ? { vehicleType: row.vehicleType, model: row.model, fuelType: row.fuelType, mileageKmPerLitre: row.mileageKmPerLitre }
    : undefined;
}

async function currentSession(session: Session): Promise<Session> {
  const row = (await allEmployees()).find((e) => e.employeeId === session.employeeId);
  return {
    ...session,
    claimUnlockUntil: row?.claimUnlockUntil || "",
    registeredVehicle: await approvedVehicleFor(session.employeeId),
  };
}

async function awaitingAcknowledgement(employeeId: string): Promise<string[]> {
  const rows = await readTab("Requests");
  return rows
    .map(toRequest)
    .filter((r) => r.employeeId === employeeId && r.status === "paid" && !r.paymentAck)
    .map((r) => r.requestId);
}

app.post("/api/requests", requireAuth, handler(async (req, res) => {
  const policy = await loadPolicy();
  const draft = normaliseDraft(req.body?.draft);
  const submit = req.body?.submit !== false;
  // Read once and reused below: buildRecord's fuel_rate has to be priced
  // against the same registered vehicle the amount itself was computed from.
  const session = await currentSession(req.session);
  const computation = computeRequest(policy, draft, session);

  if (submit) {
    const waiting = await awaitingAcknowledgement(req.session.employeeId);
    if (waiting.length) {
      res.status(400).json({
        error:
          `Please finish ${waiting.join(", ")} first — open it and tell us whether the payment reached you. ` +
          "A new claim can be raised once that is answered.",
        blockedBy: waiting,
      });
      return;
    }
  }

  if (submit && computation.errors.length) {
    res.status(400).json({ error: computation.errors[0], computation });
    return;
  }

  const manager = (await allEmployees()).find((e) => e.employeeId === req.session.lineManagerId);
  const now = nowISO();

  // Allocating the request number and writing the row must be atomic: two
  // people submitting at the same instant would otherwise read the same
  // highest number and both be issued it.
  const prefix = cfgStr(policy, "REQUEST_ID_PREFIX", "TA");
  const written = await withSheetLock(async () => {
    const requestId = await nextRequestId(prefix);
    const built = buildRecord(draft, computation, session, policy, {
      requestId,
      createdAt: now,
      status: submit ? "manager_review" : "draft",
      managerId: manager?.employeeId || "",
      managerEmail: manager?.email || "",
      submittedAt: submit ? now : "",
    });
    const rowNumber = await appendRow("Requests", fromRequest(built));
    return { built, rowNumber };
  });
  const record = await ensureUniqueRequestId(written.built, written.rowNumber, prefix);

  if (submit) await onSubmitted(record, req.session, policy);

  res.json({ request: record, computation });
}));

app.put("/api/requests/:id", requireAuth, handler(async (req, res) => {
  const rows = await readTab("Requests");
  const row = rows.find((r) => r.request_id === req.params.id);
  if (!row) {
    res.status(404).json({ error: "Request not found." });
    return;
  }
  const existing = toRequest(row);
  if (existing.employeeId !== req.session.employeeId) {
    res.status(403).json({ error: "You can only edit your own request." });
    return;
  }
  if (!["draft", "returned"].includes(existing.status)) {
    res.status(400).json({ error: `A request under ${existing.status.replace(/_/g, " ")} can no longer be edited.` });
    return;
  }

  const policy = await loadPolicy();
  const draft = normaliseDraft({ ...req.body?.draft, requestId: existing.requestId });
  const submit = req.body?.submit !== false;
  if (submit) {
    const waiting = (await awaitingAcknowledgement(req.session.employeeId))
      .filter((id) => id !== existing.requestId);
    if (waiting.length) {
      res.status(400).json({
        error:
          `Please finish ${waiting.join(", ")} first — open it and tell us whether the payment reached you.`,
        blockedBy: waiting,
      });
      return;
    }
  }
  // Read once and reused below, same as on create: buildRecord's fuel_rate has
  // to be priced against the same registered vehicle the amount used.
  const session = await currentSession(req.session);
  const computation = computeRequest(policy, draft, session);
  if (submit && computation.errors.length) {
    res.status(400).json({ error: computation.errors[0], computation });
    return;
  }

  const updated = buildRecord(draft, computation, session, policy, {
    ...existing,
    status: submit ? "manager_review" : "draft",
    submittedAt: submit ? nowISO() : existing.submittedAt,
  });

  await updateRow("Requests", row._row, fromRequest(updated));
  if (submit) await onSubmitted(updated, req.session, policy, existing.status === "returned");

  res.json({ request: updated, computation });
}));

async function onSubmitted(
  record: RequestRecord,
  session: Session,
  policy: Awaited<ReturnType<typeof loadPolicy>>,
  resubmit = false,
): Promise<void> {
  await upsertApproval(
    record.requestId,
    record.employeeName,
    [{ group: "Manager", status: "Pending", by: "", remarks: "" }],
    {
      currentStage: "manager_review",
      lastAction: resubmit ? `Resubmitted by ${session.name}` : `Submitted by ${session.name}`,
    },
  );

}

// ── Approve / reject / return ───────────────────────────────────────────────

const NEXT_STATUS: Record<string, Status> = {
  manager_review: "admin_review",
  admin_review: "finance_review",
  finance_review: "payment_processing",
};

app.post("/api/requests/:id/action", requireAuth, handler(async (req, res) => {
  const action = String(req.body?.action || "");
  const remarks = String(req.body?.remarks || "");
  const rows = await readTab("Requests");
  const row = rows.find((r) => r.request_id === req.params.id);
  if (!row) {
    res.status(404).json({ error: "Request not found." });
    return;
  }
  const record = toRequest(row);
  if (!canActOn(req.session, record)) {
    res.status(403).json({ error: "This request is not at your desk right now." });
    return;
  }
  if (!["approve", "reject", "return", "request_docs"].includes(action)) {
    res.status(400).json({ error: "Unknown action." });
    return;
  }
  // Payment is a Finance stage too, so a second Finance user could otherwise
  // "approve" an already-approved claim and overwrite the payment column with
  // a meaningless entry. Releasing money happens through /payment only.
  if (record.status === "payment_processing" && action === "approve") {
    res.status(400).json({
      error: "This claim is already approved and waiting for payment. Use “Mark paid” to release it.",
    });
    return;
  }
  if (action !== "approve" && !remarks.trim()) {
    res.status(400).json({ error: "Please add a remark explaining the decision." });
    return;
  }

  const policy = await loadPolicy();
  const currency = cfgStr(policy, "CURRENCY", "BDT");
  const stage = record.status;
  const stageLabel = policy.approvalFlow.find((f) => f.stage === stage)?.label || stage;
  const group = STAGE_COLUMN[stage];

  let next: Status = record.status;
  let stageStatus = "";
  let title = "";
  let message = "";

  // An approver may pay something other than what was claimed. It never edits
  // the employee's application — the claim stands as filed and the approved
  // figure sits beside it, so everyone downstream can see both.
  let approved = {
    approvedAmount: record.approvedAmount,
    approvedAmountBy: record.approvedAmountBy,
    approvedAmountAt: record.approvedAmountAt,
    approvedAmountNote: record.approvedAmountNote,
  };
  if (action === "approve" && req.body?.approvedAmount !== undefined && req.body?.approvedAmount !== null) {
    const amount = Number(req.body.approvedAmount);
    if (!Number.isFinite(amount) || amount < 0) {
      res.status(400).json({ error: "Enter a valid approved amount." });
      return;
    }
    const current = record.approvedAmount || record.totalClaim;
    if (amount !== current) {
      if (!remarks.trim()) {
        res.status(400).json({ error: "Add a note explaining why the amount was changed." });
        return;
      }
      approved = {
        approvedAmount: amount,
        approvedAmountBy: `${req.session.name} <${req.session.email}>`,
        approvedAmountAt: nowISO(),
        approvedAmountNote: remarks.trim(),
      };
    }
  }

  if (action === "approve") {
    next = NEXT_STATUS[stage] || record.status;
    stageStatus = "Approved";
    title = `${record.requestId} approved by ${stageLabel}`;
    message = `${req.session.name} approved your claim at the ${stageLabel} stage.${remarks ? ` Remark: ${remarks}` : ""}`;
  } else if (action === "reject") {
    next = "rejected";
    stageStatus = "Rejected";
    title = `${record.requestId} rejected`;
    message = `${req.session.name} rejected your claim at the ${stageLabel} stage. Reason: ${remarks}`;
  } else {
    // "return" and "request_docs" both hand the request back to the employee.
    next = "returned";
    stageStatus = action === "request_docs" ? "Documents Requested" : "Returned";
    title = action === "request_docs"
      ? `${record.requestId} — more documents needed`
      : `${record.requestId} returned for correction`;
    message = `${req.session.name} returned your claim at the ${stageLabel} stage. ${remarks}`;
  }

  const updated: RequestRecord = {
    ...record,
    ...approved,
    status: next,
    updatedAt: nowISO(),
    // What Finance actually pays follows the approved figure once one is set.
    finalPayable: money(
      (approved.approvedAmount || record.totalClaim) - record.advanceRequested,
    ),
    advanceStatus: record.advanceRequested > 0 && action === "approve" && stage === "manager_review"
      ? "manager_approved"
      : record.advanceStatus,
  };
  await updateRow("Requests", row._row, fromRequest(updated));

  // This desk's decision and the next desk's "Pending" go into the same row in
  // one write.
  const patches = [{
    group,
    status: stageStatus,
    by: `${req.session.name} <${req.session.email}>`,
    remarks,
  }];
  if (action === "approve" && next !== record.status && STAGE_COLUMN[next]) {
    patches.push({ group: STAGE_COLUMN[next], status: "Pending", by: "", remarks: "" });
  }
  await upsertApproval(record.requestId, record.employeeName, patches, {
    currentStage: next,
    lastAction: `${stageStatus} by ${req.session.name}`,
  });


  res.json({ request: updated });
}));

// ── Finance: payment ────────────────────────────────────────────────────────

app.post("/api/requests/:id/payment", requireAuth, handler(async (req, res) => {
  if (!hasRole(req.session, "finance")) {
    res.status(403).json({ error: "Only Finance can record a payment." });
    return;
  }
  const rows = await readTab("Requests");
  const row = rows.find((r) => r.request_id === req.params.id);
  if (!row) {
    res.status(404).json({ error: "Request not found." });
    return;
  }
  const record = toRequest(row);
  if (!["payment_processing", "payment_disputed"].includes(record.status)) {
    res.status(400).json({ error: "This request is not ready for payment." });
    return;
  }
  const answeringDispute = record.status === "payment_disputed";
  const note = String(req.body?.note || "").trim();
  if (answeringDispute && !note) {
    res.status(400).json({ error: "Add a remark explaining what happened to this payment." });
    return;
  }

  const paymentMode = String(req.body?.paymentMode || "");
  const transactionId = String(req.body?.transactionId || "").trim();
  const amount = Number(req.body?.amount);
  const paymentDate = String(req.body?.paymentDate || "").trim() || new Date().toISOString().slice(0, 10);
  if (!paymentMode) {
    res.status(400).json({ error: "Choose a payment mode." });
    return;
  }
  if (!transactionId) {
    res.status(400).json({ error: "Transaction ID is required." });
    return;
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    res.status(400).json({ error: "Enter the amount paid." });
    return;
  }

  // Recording a payment no longer closes the claim: the employee has to say
  // the money actually arrived first, which is the only check that the account
  // details were right.
  const updated: RequestRecord = {
    ...record,
    status: "paid",
    completedAt: "",
    // Paying again after a dispute reopens the question.
    paymentAck: "",
    paymentAckAt: "",
    paymentAckNote: "",
    updatedAt: nowISO(),
    paymentMode,
    transactionId,
    paymentDate,
    paidAmount: amount,
    paidBy: `${req.session.name} <${req.session.email}>`,
  };
  await updateRow("Requests", row._row, fromRequest(updated));

  await upsertApproval(
    record.requestId,
    record.employeeName,
    [{
      group: "Payment",
      status: "Paid",
      by: `${req.session.name} <${req.session.email}>`,
      remarks: [`${paymentMode} · ${transactionId} · ${amount}`, note].filter(Boolean).join(" — "),
    }],
    {
      currentStage: updated.status,
      lastAction: answeringDispute ? `Re-paid by ${req.session.name}` : `Paid by ${req.session.name}`,
    },
  );

  res.json({ request: updated });
}));

/**
 * The employee says whether the money actually arrived.
 *
 * This is the only check that the account details were right — a claim marked
 * paid against a mistyped bKash number looks settled from every other angle.
 * Saying no sends it back to Finance rather than closing it.
 */
app.post("/api/requests/:id/acknowledge", requireAuth, handler(async (req, res) => {
  const rows = await readTab("Requests");
  const row = rows.find((r) => r.request_id === req.params.id);
  if (!row) {
    res.status(404).json({ error: "Request not found." });
    return;
  }
  const record = toRequest(row);
  if (record.employeeId !== req.session.employeeId) {
    res.status(403).json({ error: "Only the person who claimed this can confirm the payment." });
    return;
  }
  if (record.status !== "paid") {
    res.status(400).json({ error: "This claim is not waiting for you to confirm a payment." });
    return;
  }

  const received = req.body?.received === true;
  const note = String(req.body?.note || "").trim();
  if (!received && !note) {
    res.status(400).json({ error: "Tell Finance what happened — they need something to look into." });
    return;
  }

  // An outstanding advance keeps the claim open even once the money is
  // confirmed: it closes when the advance is settled.
  const advanceOutstanding = record.advanceRequested > 0 && !record.settledAt;
  const updated: RequestRecord = {
    ...record,
    status: received ? (advanceOutstanding ? "paid" : "completed") : "payment_disputed",
    completedAt: received && !advanceOutstanding ? nowISO() : "",
    paymentAck: received ? "received" : "not_received",
    paymentAckAt: nowISO(),
    paymentAckNote: note,
    updatedAt: nowISO(),
  };
  await updateRow("Requests", row._row, fromRequest(updated));

  await upsertApproval(
    record.requestId,
    record.employeeName,
    [{
      group: "Payment",
      status: received ? "Confirmed by employee" : "Not received",
      by: `${req.session.name} <${req.session.email}>`,
      remarks: note,
    }],
    {
      currentStage: updated.status,
      lastAction: received
        ? `Payment confirmed by ${req.session.name}`
        : `Payment disputed by ${req.session.name}`,
    },
  );

  res.json({ request: updated });
}));

/**
 * Which advance step, if any, this person may take on this request. Keeps the
 * approval rules on the server: the Department Head is whoever sits one level
 * above the requester's line manager, so it differs per request.
 */
async function advanceStepFor(
  session: Session,
  r: RequestRecord,
): Promise<{ action: string; label: string } | null> {
  if (!r.advanceRequested || r.settledAt) return null;
  if (r.advanceStatus === "approved") {
    return hasRole(session, "finance", "hr", "admin") ? { action: "settle", label: "Record settlement" } : null;
  }
  if (r.advanceStatus === "awaiting_dept_head") {
    const head = await deptHeadIdFor(r.employeeId);
    if (session.employeeId !== head && !hasRole(session, "admin")) return null;
    return {
      action: "dept_head_approve",
      label: head ? "Department Head approval" : "Administration approval",
    };
  }
  if (r.advanceStatus === "manager_approved") {
    return hasRole(session, "hr", "admin") ? { action: "hr_approve", label: "HR approval" } : null;
  }
  return null;
}

// ── Advances (columns on the request row) ───────────────────────────────────

app.get("/api/advances", requireAuth, handler(async (req, res) => {
  const all = (await readTab("Requests")).map(toRequest).filter((r) => r.advanceRequested > 0);
  const me = req.session.employeeId;
  // `desk` is only ever other people's advances, and only for the roles that
  // sit in the advance chain.
  const desk = String(req.query.scope || "mine") === "desk";
  if (desk && !(hasRole(req.session, "hr", "finance", "admin") || await managesOthers(me))) {
    res.status(403).json({ error: "You do not review advances." });
    return;
  }
  const rows = desk ? all.filter((r) => r.employeeId !== me) : all.filter((r) => r.employeeId === me);
  // The client should not have to know the approval rules — tell it which step,
  // if any, this person can take on each advance.
  const withStep = await Promise.all(
    rows.map(async (r) => ({ ...r, myStep: await advanceStepFor(req.session, r) })),
  );
  res.json({ requests: withStep });
}));

app.post("/api/requests/:id/advance", requireAuth, handler(async (req, res) => {
  const action = String(req.body?.action || "");
  const rows = await readTab("Requests");
  const row = rows.find((r) => r.request_id === req.params.id);
  if (!row) {
    res.status(404).json({ error: "Request not found." });
    return;
  }
  const record = toRequest(row);
  if (record.advanceRequested <= 0) {
    res.status(400).json({ error: "This request has no advance." });
    return;
  }

  const policy = await loadPolicy();
  const deptHead = await deptHeadIdFor(record.employeeId);
  // Anything over the limit always takes a second approval after HR. That is
  // the department head when the employee has one; when nobody sits above the
  // line manager, Administration clears it instead — so it can never stall.
  const needsDeptHead = record.advanceRequested > cfgNum(policy, "ADVANCE_AUTO_LIMIT", 10000);
  const stamp = `${req.session.name} <${req.session.email}>`;
  const updated: RequestRecord = { ...record, updatedAt: nowISO() };
  let group: "AdvanceHR" | "AdvanceDeptHead" | undefined;
  let stageStatus = "";

  if (action === "hr_approve") {
    // Administration can do anything HR can, so it stands in here too.
    if (!hasRole(req.session, "hr", "admin")) {
      res.status(403).json({ error: "Only HR or Administration can approve at this step." });
      return;
    }
    updated.advanceApproved = Number(req.body?.amount) || record.advanceRequested;
    updated.advanceStatus = needsDeptHead ? "awaiting_dept_head" : "approved";
    group = "AdvanceHR";
    stageStatus = "Approved";
  } else if (action === "dept_head_approve") {
    if (req.session.employeeId !== deptHead && !hasRole(req.session, "admin")) {
      res.status(403).json({ error: "Only this employee's Department Head or Administration can approve at this step." });
      return;
    }
    updated.advanceApproved = Number(req.body?.amount) || record.advanceApproved || record.advanceRequested;
    updated.advanceStatus = "approved";
    group = "AdvanceDeptHead";
    stageStatus = "Approved";
  } else if (action === "reject") {
    const isHead = req.session.employeeId === deptHead;
    if (!hasRole(req.session, "hr", "finance", "admin") && !isHead) {
      res.status(403).json({ error: "You cannot reject this advance." });
      return;
    }
    updated.advanceStatus = "rejected";
    group = record.advanceStatus === "awaiting_dept_head" ? "AdvanceDeptHead" : "AdvanceHR";
    stageStatus = "Rejected";
  } else if (action === "settle") {
    const settled = Number(req.body?.settledAmount);
    if (!Number.isFinite(settled)) {
      res.status(400).json({ error: "Enter the settled amount." });
      return;
    }
    updated.settledAmount = settled;
    updated.settledAt = nowISO();
    updated.advanceStatus = "settled";
    // Settling closes out a request that was parked in "paid".
    if (record.status === "paid") {
      updated.status = "completed";
      updated.completedAt = nowISO();
    }
    stageStatus = "Settled";
  } else {
    res.status(400).json({ error: "Unknown action." });
    return;
  }

  await updateRow("Requests", row._row, fromRequest(updated));
  await upsertApproval(
    record.requestId,
    record.employeeName,
    group ? [{ group, status: stageStatus, by: stamp }] : [],
    {
      currentStage: updated.status,
      lastAction: `Advance ${stageStatus.toLowerCase()} by ${req.session.name}`,
    },
  );


  res.json({ request: updated });
}));

// ── Admin configuration ─────────────────────────────────────────────────────

const EDITABLE_TABS = ["Config", "BandPolicy", "Lists", "Employees"];

app.get("/api/admin/tabs", requireAuth, handler(async (req, res) => {
  if (!hasRole(req.session, "admin", "hr")) {
    res.status(403).json({ error: "Admin access required." });
    return;
  }
  const data = await readTabs(EDITABLE_TABS);
  const headers = Object.fromEntries(
    await Promise.all(EDITABLE_TABS.map(async (t) => [t, await getHeaders(t)] as const)),
  );
  res.json({ tabs: EDITABLE_TABS, headers, data });
}));

/**
 * Opens the claim window for one person who missed it.
 *
 * Granted against the employee rather than a claim, because the claim they
 * need to file does not exist yet — the window is what is stopping them
 * creating it.
 */
app.post("/api/admin/claim-unlock", requireAuth, handler(async (req, res) => {
  if (!hasRole(req.session, "admin", "hr")) {
    res.status(403).json({ error: "Admin access required." });
    return;
  }
  const employeeId = String(req.body?.employeeId || "").trim();
  const until = String(req.body?.until || "").trim();
  // An empty date takes the unlock away again.
  if (until && !/^\d{4}-\d{2}-\d{2}$/.test(until)) {
    res.status(400).json({ error: "Give the date to unlock until, as YYYY-MM-DD." });
    return;
  }
  const rows = await readTab("Employees");
  const row = rows.find((r) => r.employee_id === employeeId);
  if (!row) {
    res.status(404).json({ error: "No employee with that ID." });
    return;
  }
  // updateRow replaces the whole row, so the record is carried over intact and
  // only the one cell changed.
  const { _row, ...rest } = row;
  await updateRow("Employees", _row, { ...rest, claim_unlock_until: until });
  invalidateEmployees();
  res.json({ ok: true, employeeId, until });
}));

// ── Vehicles: register, approve, claim against ──────────────────────────────

/** The signed-in employee's own vehicle registration, whatever state it is in. */
app.get("/api/vehicles/mine", requireAuth, handler(async (req, res) => {
  const rows = await readTab("Vehicles");
  const row = rows.map(toVehicle).find((v) => v.employeeId === req.session.employeeId);
  if (!row) { res.json({ vehicle: null }); return; }
  const { _row, ...vehicle } = row;
  res.json({ vehicle });
}));

/**
 * Submits a vehicle for approval, or resubmits one already on file.
 *
 * One row per employee — a resubmission overwrites it and drops the status
 * back to pending, since a changed mileage or fuel type changes the rate a
 * claim would be priced at, and that has to be looked at again.
 */
app.post("/api/vehicles", requireAuth, handler(async (req, res) => {
  const vehicleType = req.body?.vehicleType === "Car" ? "Car" : req.body?.vehicleType === "Bike" ? "Bike" : "";
  const model = String(req.body?.model || "").trim();
  const fuelType = String(req.body?.fuelType || "").trim();
  const mileageKmPerLitre = Number(req.body?.mileageKmPerLitre);
  const imageLink = String(req.body?.imageLink || "").trim();

  if (!vehicleType) { res.status(400).json({ error: "Select whether this is a bike or a car." }); return; }
  if (!model) { res.status(400).json({ error: "Enter the vehicle's model." }); return; }
  const policy = await loadPolicy();
  if (!policy.fuelTypes.some((f) => f.value === fuelType)) {
    res.status(400).json({ error: "Select a fuel type." });
    return;
  }
  if (!(mileageKmPerLitre > 0)) {
    res.status(400).json({ error: "Enter how many km this vehicle does on one litre." });
    return;
  }

  const record: VehicleRegistration = {
    employeeId: req.session.employeeId,
    employeeName: req.session.name,
    vehicleType,
    model,
    fuelType,
    mileageKmPerLitre,
    imageLink,
    status: "pending",
    submittedAt: nowISO(),
    reviewedBy: "",
    reviewedAt: "",
    reviewNote: "",
  };

  const rows = await readTab("Vehicles");
  const existing = rows.find((r) => r.employee_id === req.session.employeeId);
  if (existing) await updateRow("Vehicles", existing._row, fromVehicle(record));
  else await appendRow("Vehicles", fromVehicle(record));

  res.json({ vehicle: record });
}));

/** The vehicles HR/Admin have to decide on — or everyone's, for a full register. */
app.get("/api/vehicles", requireAuth, handler(async (req, res) => {
  if (!hasRole(req.session, "admin", "hr")) {
    res.status(403).json({ error: "Admin access required." });
    return;
  }
  const scope = String(req.query.scope || "pending");
  const rows = (await readTab("Vehicles")).map(toVehicle);
  const filtered = scope === "all" ? rows : rows.filter((v) => v.status === "pending");
  const vehicles = filtered
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
    .map(({ _row, ...v }) => v);
  res.json({ vehicles });
}));

app.post("/api/vehicles/:employeeId/decide", requireAuth, handler(async (req, res) => {
  if (!hasRole(req.session, "admin", "hr")) {
    res.status(403).json({ error: "Admin access required." });
    return;
  }
  const action = req.body?.action === "approve" ? "approved" : req.body?.action === "reject" ? "rejected" : "";
  const remarks = String(req.body?.remarks || "").trim();
  if (!action) { res.status(400).json({ error: "Unknown action." }); return; }
  if (action === "rejected" && !remarks) {
    res.status(400).json({ error: "Add a remark explaining why this vehicle was not approved." });
    return;
  }

  const rows = await readTab("Vehicles");
  const row = rows.find((r) => r.employee_id === req.params.employeeId);
  if (!row) { res.status(404).json({ error: "No vehicle registration for that employee." }); return; }
  const { _row, ...current } = toVehicle(row);

  const updated: VehicleRegistration = {
    ...current,
    status: action,
    reviewedBy: `${req.session.name} <${req.session.email}>`,
    reviewedAt: nowISO(),
    reviewNote: remarks,
  };
  await updateRow("Vehicles", _row, fromVehicle(updated));
  res.json({ vehicle: updated });
}));

app.post("/api/admin/tabs/:tab", requireAuth, handler(async (req, res) => {
  if (!hasRole(req.session, "admin", "hr")) {
    res.status(403).json({ error: "Admin access required." });
    return;
  }
  const tab = req.params.tab;
  if (!EDITABLE_TABS.includes(tab)) {
    res.status(400).json({ error: "That tab is not editable from here." });
    return;
  }
  const rows = Array.isArray(req.body?.rows) ? (req.body.rows as Row[]) : [];
  await replaceTabRows(tab, rows);
  invalidatePolicy();
  invalidateEmployees();
  res.json({ ok: true, rows: rows.length });
}));

/**
 * Sheets API usage since the last reset, for checking headroom against
 * Google's 300 reads/min and 300 writes/min quotas.
 */
app.get("/api/admin/stats", requireAuth, handler(async (req, res) => {
  if (!hasRole(req.session, "admin", "hr")) {
    res.status(403).json({ error: "Admin access required." });
    return;
  }
  if (req.query.reset === "1") resetApiCalls();
  const seconds = Math.max(1, (Date.now() - apiCalls.since) / 1000);
  res.json({
    ...apiCalls,
    windowSeconds: Math.round(seconds),
    readsPerMinute: +(apiCalls.reads / (seconds / 60)).toFixed(1),
    writesPerMinute: +(apiCalls.writes / (seconds / 60)).toFixed(1),
  });
}));

export default app;
