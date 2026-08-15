/**
 * Domain layer: converts between sheet rows and typed records, loads the
 * admin-configured policy, and owns ID generation.
 *
 * A request occupies exactly one row. The repeating parts — trips, team
 * members, document links — are packed into a single cell each, one item per
 * line with ` | ` between fields, so the sheet stays readable and a request is
 * never spread across rows.
 */

import crypto from "crypto";
import { appendRow, readTab, readTabs, updateRow, withSheetLock, type Row } from "./sheets.js";
import type {
  ApprovalRow, Leg, Policy, RequestRecord, Role, SessionUser, StageKey, Status, TeamMember, VehicleRegistration,
} from "../shared/types.js";

const num = (v: string | undefined): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const bool = (v: string | undefined): boolean =>
  ["yes", "true", "1"].includes(String(v || "").trim().toLowerCase());
const yn = (v: boolean): string => (v ? "Yes" : "No");
const csv = (v: string | undefined): string[] =>
  String(v || "").split(",").map((s) => s.trim()).filter(Boolean);
const lines = (v: string | undefined): string[] =>
  String(v || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

export function nowISO(): string {
  return new Date().toISOString();
}

export function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
}

/** Splits document links pasted on one line, on several lines, or comma-separated. */
export function parseLinks(input: string | string[] | undefined): string[] {
  const raw = Array.isArray(input) ? input.join("\n") : String(input || "");
  return raw
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// ── Policy ──────────────────────────────────────────────────────────────────

let policyCache: { policy: Policy; at: number } | null = null;
const POLICY_TTL_MS = 30_000;

export function invalidatePolicy(): void {
  policyCache = null;
}

export async function loadPolicy(): Promise<Policy> {
  if (policyCache && Date.now() - policyCache.at < POLICY_TTL_MS) return policyCache.policy;

  const tabs = await readTabs(["Config", "BandPolicy", "Lists"]);
  const active = tabs.Lists.filter((r) => bool(r.active));
  const of = (name: string) => active.filter((r) => r.list_name === name);

  const policy: Policy = {
    config: Object.fromEntries(tabs.Config.map((r) => [r.key, r.value])),
    bands: tabs.BandPolicy.map((r) => ({
      band: r.band,
      modesMale: csv(r.modes_male),
      modesFemale: csv(r.modes_female),
      outsideTAWeekday: num(r.outside_ta_weekday),
      outsideTAWeekend: num(r.outside_ta_weekend),
      accommodationLimit: num(r.accommodation_limit),
      flightEligible: bool(r.flight_eligible),
      carPoolEligible: bool(r.car_pool_eligible),
    })),
    cities: of("City").map((r) => ({
      city: r.value,
      zone: (r.extra_1 === "Outside" ? "Outside" : "Inside") as "Inside" | "Outside",
    })),
    modes: of("TransportMode").map((r) => ({
      mode: r.value,
      label: r.label || r.value,
      scope: (["Inside", "Outside", "Both"].includes(r.extra_1) ? r.extra_1 : "Both") as "Inside" | "Outside" | "Both",
      requiresReceipt: bool(r.extra_2),
    })),
    workedAtOptions: of("WorkedAt").map((r) => r.value),
    destinationTypes: of("DestinationType").map((r) => ({
      value: r.value,
      label: r.label || r.value,
      needs: (r.extra_1 === "Office" ? "office" : r.extra_1 === "Purpose" ? "purpose" : "name") as
        "name" | "office" | "purpose",
      cities: csv(r.extra_2),
    })),
    otherOffices: of("OtherOffice").map((r) => r.value),
    routes: of("Route").map((r) => ({
      value: r.value,
      label: r.label || r.value,
      from: r.extra_1 || "",
      to: r.extra_2 || "",
    })),
    dualWorkstationOptions: of("DualWorkstation").map((r) => r.value),
    paymentMethods: of("PaymentMethod").map((r) => r.value),
    documentTypes: of("DocumentType").map((r) => r.value),
    fuelTypes: of("FuelType").map((r) => ({ value: r.value, label: r.label || r.value, pricePerLitre: num(r.extra_1) })),
    approvalFlow: of("ApprovalStage")
      .map((r) => ({ step: num(r.extra_1), stage: r.value, label: r.label || r.value, roleRequired: r.extra_2 }))
      .sort((a, b) => a.step - b.step),
  };

  policyCache = { policy, at: Date.now() };
  return policy;
}

// ── Employees ───────────────────────────────────────────────────────────────

export interface EmployeeRow extends SessionUser {
  password: string;
  status: string;
  authId: string;
  _row: string;
}

const ROLES: Role[] = ["user", "admin", "hr", "finance"];

/**
 * Everyone can raise a claim, so `user` is always granted and never has to be
 * written in the sheet. `employee` from the earlier layout is read as `user`,
 * and anything unrecognised is ignored rather than silently granting access.
 */
function parseRoles(raw: string | undefined): Role[] {
  const named = csv(raw)
    .map((r) => r.toLowerCase())
    .map((r) => (r === "employee" ? "user" : r))
    .filter((r): r is Role => (ROLES as string[]).includes(r));
  return [...new Set<Role>(["user", ...named])];
}

export function toEmployee(r: Row & { _row: string }): EmployeeRow {
  return {
    authId: r.auth_id,
    employeeId: r.employee_id,
    name: r.name,
    email: String(r.email || "").trim(),
    password: String(r.password ?? ""),
    gender: r.gender,
    band: r.band,
    department: r.department,
    designation: r.designation,
    lineManagerId: r.line_manager_id,
    roles: parseRoles(r.roles),
    paymentMethod: r.payment_method,
    accountNumber: r.account_number,
    claimUnlockUntil: r.claim_unlock_until || "",
    status: r.status || "Active",
    _row: r._row,
  };
}

/**
 * The roster is read on login, on every team-member search and on every
 * approval (to find the next desk's recipients). It changes rarely, so a short
 * cache removes most of those reads. Admin edits invalidate it immediately; a
 * row added straight into the sheet is picked up within the TTL.
 */
let employeeCache: { rows: EmployeeRow[]; at: number } | null = null;
const EMPLOYEE_TTL_MS = 45_000;

export function invalidateEmployees(): void {
  employeeCache = null;
}

export async function allEmployees(): Promise<EmployeeRow[]> {
  if (employeeCache && Date.now() - employeeCache.at < EMPLOYEE_TTL_MS) return employeeCache.rows;
  const rows = (await readTab("Employees")).map(toEmployee);
  employeeCache = { rows, at: Date.now() };
  return rows;
}

/**
 * Records the identity provider's subject id against the employee the first
 * time they sign in with SSO, so the sheet shows which account each person
 * actually authenticates with. Only writes when it changed, so a normal
 * sign-in costs no extra write.
 */
export async function rememberAuthId(employeeRow: string, authId: string): Promise<void> {
  if (!employeeRow || !authId) return;
  const rows = await readTab("Employees");
  const row = rows.find((r) => r._row === employeeRow);
  if (!row || row.auth_id === authId) return;
  const { _row, ...rest } = row;
  await updateRow("Employees", employeeRow, { ...rest, auth_id: authId });
  invalidateEmployees();
}

// ── Hierarchy, derived from the LineManagerID column ────────────────────────

/**
 * True when anyone active reports to this person. That is the whole definition
 * of "line manager" in this system — nothing is written in the Roles column,
 * so moving a report to a different manager immediately moves the approval.
 */
export async function managesOthers(employeeId: string): Promise<boolean> {
  if (!employeeId) return false;
  return (await allEmployees()).some(
    (e) => e.status === "Active" && e.lineManagerId === employeeId && e.employeeId !== employeeId,
  );
}

/**
 * The department head for a given employee: one level above the line manager
 * who approves their claims. If the line manager is already the top of the
 * chain there is no separate head, and the advance stops at HR.
 *
 * Walks at most a few links so a bad LineManagerID loop can never hang.
 */
export async function deptHeadIdFor(employeeId: string): Promise<string> {
  const byId = new Map((await allEmployees()).map((e) => [e.employeeId, e]));
  const employee = byId.get(employeeId);
  const lineManager = employee?.lineManagerId ? byId.get(employee.lineManagerId) : undefined;
  if (!lineManager || lineManager.employeeId === employeeId) return "";
  const head = lineManager.lineManagerId ? byId.get(lineManager.lineManagerId) : undefined;
  if (!head || head.employeeId === lineManager.employeeId) return "";
  return head.employeeId;
}

// ── Packing repeating data into a single cell ───────────────────────────────

function packTeam(members: TeamMember[]): string {
  return members
    .map((m) => [m.employeeId, m.name, m.department, m.designation, m.band, m.gender, m.bkashNumber].join(" | "))
    .join("\n");
}

function unpackTeam(cell: string | undefined): TeamMember[] {
  return lines(cell).map((line) => {
    const [employeeId = "", name = "", department = "", designation = "", band = "", gender = "", bkashNumber = ""] =
      line.split("|").map((s) => s.trim());
    return { employeeId, name, department, designation, band, gender, bkashNumber };
  });
}

function packTrips(legs: Leg[]): string {
  return legs
    .map((l) => [l.travelDate, l.mode, l.travelFrom, l.travelTo, l.amount, l.note].join(" | "))
    .join("\n");
}

function unpackTrips(cell: string | undefined): Leg[] {
  return lines(cell).map((line) => {
    const [travelDate = "", mode = "", travelFrom = "", travelTo = "", amount = "", note = ""] =
      line.split("|").map((s) => s.trim());
    return { travelDate, mode, travelFrom, travelTo, amount: num(amount), note };
  });
}

// ── Requests ────────────────────────────────────────────────────────────────

export function toRequest(r: Row & { _row: string }): RequestRecord & { _row: string } {
  return {
    _row: r._row,
    requestId: r.request_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    status: (r.status || "draft") as Status,
    employeeId: r.employee_id,
    employeeName: r.employee_name,
    email: r.email,
    band: r.band,
    department: r.department,
    designation: r.designation,
    scope: r.scope === "outside" ? "outside" : "inside",
    city: r.city,
    claimType: (["ta", "perdiem", "both"].includes(r.claim_type) ? r.claim_type : "both") as RequestRecord["claimType"],
    travelType: r.travel_type === "team" ? "team" : "individual",
    teamSize: num(r.team_size),
    teamMembers: unpackTeam(r.team_members),
    fromDate: r.from_date,
    toDate: r.to_date,
    tripDays: num(r.trip_days),
    purpose: r.purpose,
    destinationType: r.destination_type || "",
    tripDirection: r.trip_direction === "two_way" ? "two_way" : "one_way",
    route: r.route || "",
    exceptionClaimed: bool(r.exception_claimed),
    exceptionReason: r.exception_reason || "",
    advanceWanted: bool(r.advance_wanted),
    payoutMethod: r.payout_method === "bank" ? "bank" : "bkash",
    bankName: r.bank_name || "",
    bankAccountName: r.bank_account_name || "",
    bankAccountNumber: r.bank_account_number || "",
    bankRoutingNumber: r.bank_routing_number || "",
    bankBranch: r.bank_branch || "",
    paymentAck: r.payment_ack || "",
    paymentAckAt: r.payment_ack_at || "",
    paymentAckNote: r.payment_ack_note || "",
    approvedAmount: num(r.approved_amount),
    approvedAmountBy: r.approved_amount_by || "",
    approvedAmountAt: r.approved_amount_at || "",
    approvedAmountNote: r.approved_amount_note || "",
    destination: r.destination,
    startTime: r.start_time,
    endTime: r.end_time,
    workingHours: num(r.working_hours),
    workedAt: r.worked_at,
    arrangement: r.arrangement === "company" ? "company" : "self",
    transportMode: r.transport_mode,
    vehicleType: r.vehicle_type,
    carSpecialApproval: bool(r.car_special_approval),
    travelFrom: r.travel_from,
    travelTo: r.travel_to,
    totalKM: num(r.total_km),
    fuelRate: num(r.fuel_rate),
    legs: unpackTrips(r.trips),
    taAmount: num(r.ta_amount),
    perDiemDays: num(r.per_diem_days),
    perDiemAmount: num(r.per_diem_amount),
    lunchAllowance: num(r.lunch_allowance),
    officeMealTaken: bool(r.office_meal_taken),
    dualWorkstation: bool(r.dual_workstation),
    dualWorkstationType: r.dual_workstation_type,
    hotelName: r.hotel_name,
    checkIn: r.check_in,
    checkOut: r.check_out,
    accommodationAmount: num(r.accommodation_amount),
    rentACarAmount: num(r.rent_a_car_amount),
    rentACarHeadcount: num(r.rent_a_car_headcount),
    flightAmount: num(r.flight_amount),
    otherAmount: num(r.other_amount),
    otherNote: r.other_note,
    totalClaim: num(r.total_claim),
    advanceRequested: num(r.advance_requested),
    bkashNumber: r.bkash_number,
    advanceApproved: num(r.advance_approved),
    advanceStatus: r.advance_status,
    settlementDueDate: r.settlement_due_date,
    settledAmount: num(r.settled_amount),
    settledAt: r.settled_at,
    finalPayable: num(r.final_payable),
    managerId: r.manager_id,
    managerEmail: r.manager_email,
    submittedAt: r.submitted_at,
    completedAt: r.completed_at,
    documentTypes: csv(r.document_types),
    documentLinks: lines(r.document_links),
    policyNotes: r.policy_notes,
    employeeNote: r.employee_note,
    paymentMode: r.payment_mode,
    transactionId: r.transaction_id,
    paymentDate: r.payment_date,
    paidAmount: num(r.paid_amount),
    paidBy: r.paid_by,
  };
}

export function fromRequest(req: RequestRecord): Row {
  return {
    request_id: req.requestId,
    created_at: req.createdAt,
    updated_at: req.updatedAt,
    status: req.status,
    employee_id: req.employeeId,
    employee_name: req.employeeName,
    email: req.email,
    band: req.band,
    department: req.department,
    designation: req.designation,
    scope: req.scope,
    city: req.city,
    claim_type: req.claimType,
    travel_type: req.travelType,
    team_size: String(req.teamSize),
    team_members: packTeam(req.teamMembers),
    from_date: req.fromDate,
    to_date: req.toDate,
    trip_days: String(req.tripDays),
    purpose: req.purpose,
    destination_type: req.destinationType,
    trip_direction: req.tripDirection,
    route: req.route,
    exception_claimed: req.exceptionClaimed ? "Yes" : "No",
    exception_reason: req.exceptionReason,
    advance_wanted: req.advanceWanted ? "Yes" : "No",
    payout_method: req.payoutMethod,
    bank_name: req.bankName,
    bank_account_name: req.bankAccountName,
    bank_account_number: req.bankAccountNumber,
    bank_routing_number: req.bankRoutingNumber,
    bank_branch: req.bankBranch,
    payment_ack: req.paymentAck,
    payment_ack_at: req.paymentAckAt,
    payment_ack_note: req.paymentAckNote,
    approved_amount: String(req.approvedAmount || ""),
    approved_amount_by: req.approvedAmountBy,
    approved_amount_at: req.approvedAmountAt,
    approved_amount_note: req.approvedAmountNote,
    destination: req.destination,
    start_time: req.startTime,
    end_time: req.endTime,
    working_hours: String(req.workingHours),
    worked_at: req.workedAt,
    arrangement: req.arrangement,
    transport_mode: req.transportMode,
    vehicle_type: req.vehicleType,
    car_special_approval: yn(req.carSpecialApproval),
    travel_from: req.travelFrom,
    travel_to: req.travelTo,
    total_km: String(req.totalKM),
    fuel_rate: String(req.fuelRate),
    trips: packTrips(req.legs),
    ta_amount: String(req.taAmount),
    per_diem_days: String(req.perDiemDays),
    per_diem_amount: String(req.perDiemAmount),
    lunch_allowance: String(req.lunchAllowance),
    office_meal_taken: yn(req.officeMealTaken),
    dual_workstation: yn(req.dualWorkstation),
    dual_workstation_type: req.dualWorkstationType,
    hotel_name: req.hotelName,
    check_in: req.checkIn,
    check_out: req.checkOut,
    accommodation_amount: String(req.accommodationAmount),
    rent_a_car_amount: String(req.rentACarAmount),
    rent_a_car_headcount: String(req.rentACarHeadcount),
    flight_amount: String(req.flightAmount),
    other_amount: String(req.otherAmount),
    other_note: req.otherNote,
    total_claim: String(req.totalClaim),
    advance_requested: String(req.advanceRequested),
    bkash_number: req.bkashNumber,
    advance_approved: String(req.advanceApproved),
    advance_status: req.advanceStatus,
    settlement_due_date: req.settlementDueDate,
    settled_amount: req.settledAmount ? String(req.settledAmount) : "",
    settled_at: req.settledAt,
    final_payable: String(req.finalPayable),
    manager_id: req.managerId,
    manager_email: req.managerEmail,
    submitted_at: req.submittedAt,
    completed_at: req.completedAt,
    document_types: req.documentTypes.join(", "),
    document_links: req.documentLinks.join("\n"),
    payment_mode: req.paymentMode,
    transaction_id: req.transactionId,
    payment_date: req.paymentDate,
    paid_amount: req.paidAmount ? String(req.paidAmount) : "",
    paid_by: req.paidBy,
    policy_notes: req.policyNotes,
    employee_note: req.employeeNote,
  };
}

// ── Vehicles ─────────────────────────────────────────────────────────────────
// One row per employee. A resubmission overwrites it in place rather than
// adding a row — there is only ever one current registration to approve.

export function toVehicle(r: Row & { _row: string }): VehicleRegistration & { _row: string } {
  return {
    _row: r._row,
    employeeId: r.employee_id,
    employeeName: r.employee_name,
    vehicleType: r.vehicle_type === "Car" ? "Car" : "Bike",
    model: r.model,
    fuelType: r.fuel_type,
    mileageKmPerLitre: num(r.mileage_km_per_litre),
    imageLink: r.image_link,
    status: (["pending", "approved", "rejected"].includes(r.status) ? r.status : "pending") as VehicleRegistration["status"],
    submittedAt: r.submitted_at,
    reviewedBy: r.reviewed_by,
    reviewedAt: r.reviewed_at,
    reviewNote: r.review_note,
  };
}

export function fromVehicle(v: VehicleRegistration): Row {
  return {
    employee_id: v.employeeId,
    employee_name: v.employeeName,
    vehicle_type: v.vehicleType,
    model: v.model,
    fuel_type: v.fuelType,
    mileage_km_per_litre: String(v.mileageKmPerLitre),
    image_link: v.imageLink,
    status: v.status,
    submitted_at: v.submittedAt,
    reviewed_by: v.reviewedBy,
    reviewed_at: v.reviewedAt,
    review_note: v.reviewNote,
  };
}

/** Human-readable, sortable request number: TA-2026-000147. */
export async function nextRequestId(prefix: string): Promise<string> {
  const rows = await readTab("Requests");
  const year = new Date().getFullYear();
  const used = rows
    .map((r) => r.request_id)
    .filter((rid) => rid?.startsWith(`${prefix}-${year}-`))
    .map((rid) => Number(rid.split("-")[2]) || 0);
  return `${prefix}-${year}-${String((used.length ? Math.max(...used) : 0) + 1).padStart(6, "0")}`;
}

// ── Approvals: one row per request, one column group per desk ───────────────

export function toApprovalRow(r: Row & { _row: string }): ApprovalRow & { _row: string } {
  return {
    _row: r._row,
    requestId: r.request_id,
    employeeName: r.employee_name,
    currentStage: r.current_stage,
    submittedAt: r.submitted_at,
    submittedRemarks: r.submitted_remarks,
    managerStatus: r.manager_status,
    managerBy: r.manager_by,
    managerAt: r.manager_at,
    managerRemarks: r.manager_remarks,
    adminStatus: r.admin_status,
    adminBy: r.admin_by,
    adminAt: r.admin_at,
    adminRemarks: r.admin_remarks,
    financeStatus: r.finance_status,
    financeBy: r.finance_by,
    financeAt: r.finance_at,
    financeRemarks: r.finance_remarks,
    paymentStatus: r.payment_status,
    paymentBy: r.payment_by,
    paymentAt: r.payment_at,
    paymentRemarks: r.payment_remarks,
    advanceHRStatus: r.advance_hr_status,
    advanceHRBy: r.advance_hr_by,
    advanceHRAt: r.advance_hr_at,
    advanceDeptHeadStatus: r.advance_dept_head_status,
    advanceDeptHeadBy: r.advance_dept_head_by,
    advanceDeptHeadAt: r.advance_dept_head_at,
    lastAction: r.last_action,
    lastActionAt: r.last_action_at,
  };
}

/** Which Approvals column group a workflow stage writes into. */
/**
 * Sheet column prefix for each approval desk. The TypeScript records keep
 * camelCase property names; the sheet uses snake_case, so the two are mapped
 * here rather than derived from each other.
 */
const SHEET_PREFIX: Record<StageKey | "AdvanceHR" | "AdvanceDeptHead", string> = {
  Manager: "manager",
  Admin: "admin",
  Finance: "finance",
  Payment: "payment",
  AdvanceHR: "advance_hr",
  AdvanceDeptHead: "advance_dept_head",
};

export const STAGE_COLUMN: Record<string, StageKey> = {
  manager_review: "Manager",
  admin_review: "Admin",
  finance_review: "Finance",
  payment_processing: "Payment",
};

export interface StagePatch {
  /** Column group to write, e.g. "Manager". */
  group: StageKey | "AdvanceHR" | "AdvanceDeptHead";
  status?: string;
  by?: string;
  remarks?: string;
}

export interface ApprovalMeta {
  currentStage?: string;
  lastAction?: string;
}

/**
 * Creates the request's Approvals row if it does not exist yet, then applies
 * every column-group patch in one write. Approving normally touches two groups
 * — this desk's result and the next desk's "Pending" — and doing both in a
 * single call halves the write cost of an approval.
 *
 * Re-deciding a stage overwrites that group, which is the point: one request,
 * one row.
 */
export async function upsertApproval(
  requestId: string,
  employeeName: string,
  patches: StagePatch[],
  meta: ApprovalMeta = {},
): Promise<void> {
  // Read-then-create, so it has to be serialised: two approvals landing at the
  // same instant would otherwise both see "no row yet" and append two.
  await withSheetLock(async () => {
  const rows = await readTab("Approvals");
  const existing = rows.find((r) => r.request_id === requestId);
  const stamp = nowISO();

  const base: Row = existing
    ? { ...existing }
    : { request_id: requestId, employee_name: employeeName, submitted_at: stamp };

  if (meta.currentStage !== undefined) base.current_stage = meta.currentStage;
  if (meta.lastAction) {
    base.last_action = meta.lastAction;
    base.last_action_at = stamp;
  }

  for (const patch of patches) {
    const col = SHEET_PREFIX[patch.group];
    if (patch.status !== undefined) base[`${col}_status`] = patch.status;
    if (patch.by !== undefined) base[`${col}_by`] = patch.by;
    base[`${col}_at`] = stamp;
    if (patch.remarks !== undefined && patch.group !== "AdvanceHR" && patch.group !== "AdvanceDeptHead") {
      base[`${col}_remarks`] = patch.remarks;
    }
  }

    delete base._row;
    if (existing) await updateRow("Approvals", existing._row, base);
    else await appendRow("Approvals", base);
  });
}

