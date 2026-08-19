/**
 * Shared logic for the Requests resource — split out of the old single
 * Express app.ts so every `app/api/requests/**` route handler can reuse it.
 * Ported as-is; only the surrounding file changed.
 */

import { readTab, updateRow } from './sheets';
import { hasRole, type Session } from './auth';
import {
  allEmployees,
  deptHeadIdFor,
  fromRequest,
  insideCityBlockedEmails,
  loadPolicy,
  nowISO,
  parseLinks,
  toRequest,
  toVehicle,
} from './store';
import {
  addBusinessDays,
  cfgNum,
  computeRequest,
  money,
  personalVehicleRateFor,
} from '../shared/policy';
import { STATUS_GROUPS, type StatusGroup } from '../shared/types';
import type {
  RequestDraft,
  RequestRecord,
  SessionUser,
  Status,
  TeamMember,
} from '../shared/types';

/**
 * What a user may see. Employees see their own requests plus anything they are
 * a team member on; approvers additionally see everything at their desk, and
 * Admin/Finance/HR see the whole pipeline for reporting.
 */
export function canView(session: Session, req: RequestRecord): boolean {
  // A team-child record is internal bookkeeping split off the main request
  // so Finance can pay and reconcile each traveller separately — the
  // teammate it's nominally under never sees it, even by employeeId match.
  if (req.linkedTo) return hasRole(session, 'admin', 'finance', 'hr');
  if (req.employeeId === session.employeeId) return true;
  if (req.teamMembers.some((m) => m.employeeId === session.employeeId))
    return true;
  if (hasRole(session, 'admin', 'finance', 'hr')) return true;
  // Line-manager access is decided by the request's ManagerID — which came from
  // the requester's LineManagerID — not by any role in the sheet.
  if (req.managerId === session.employeeId) return true;
  return false;
}

export function canActOn(session: Session, req: RequestRecord): boolean {
  // A child mirrors the main request's status automatically through the
  // review stages — see the cascade in the action handler — so nobody
  // approves/rejects/returns it on its own. Once it reaches Finance, though,
  // each wallet is a separate real transfer, so it's paid independently.
  if (
    req.linkedTo &&
    !['payment_processing', 'payment_disputed'].includes(req.status)
  )
    return false;
  switch (req.status) {
    // A line manager acts only on their own reports; Administration can unblock.
    case 'manager_review':
      return req.managerId === session.employeeId || hasRole(session, 'admin');
    case 'admin_review':
      return hasRole(session, 'admin');
    case 'finance_review':
    case 'payment_processing':
    // The employee says the money never arrived — Finance has to answer that.
    case 'payment_disputed':
      return hasRole(session, 'finance');
    default:
      return false;
  }
}

export function summarise(rows: RequestRecord[]) {
  // Counted from the shared group definitions, so a card's number always
  // matches the list clicking it opens.
  const count = (g: StatusGroup) =>
    rows.filter((r) =>
      (STATUS_GROUPS[g].statuses as readonly Status[]).includes(r.status),
    ).length;
  return {
    pending: count('pending'),
    approved: count('approved'),
    rejected: count('rejected'),
    returned: count('returned'),
    paymentPending: count('paymentPending'),
    paid: count('paid'),
    totalClaims: rows.reduce((s, r) => s + r.totalClaim, 0),
    totalPaid: rows
      .filter((r) => ['paid', 'completed'].includes(r.status))
      .reduce((s, r) => s + r.finalPayable, 0),
    count: rows.length,
  };
}

/** Fills in every field so a partial payload from the client can't throw. */
export function normaliseDraft(raw: unknown): RequestDraft {
  const d = (raw ?? {}) as Partial<RequestDraft>;
  const n = (v: unknown) => {
    const x = Number(v);
    return Number.isFinite(x) ? x : 0;
  };
  return {
    requestId: d.requestId || '',
    scope: d.scope === 'outside' ? 'outside' : 'inside',
    city: d.city || '',
    claimType: (['ta', 'perdiem', 'both'].includes(String(d.claimType))
      ? d.claimType
      : 'both') as RequestDraft['claimType'],
    travelType: d.travelType === 'team' ? 'team' : 'individual',
    teamMembers: Array.isArray(d.teamMembers) ? d.teamMembers : [],
    fromDate: d.fromDate || '',
    // Left empty rather than falling back to the departure date: an
    // outside-city claim with no return date has to be refused, and silently
    // making it a same-day trip both hid that and paid one day of per-diem.
    toDate: String(d.toDate || ''),
    purpose: d.purpose || '',
    destinationType: d.destinationType || '',
    tripDirection: d.tripDirection === 'two_way' ? 'two_way' : 'one_way',
    route: d.route || '',
    dhakaOffice: d.dhakaOffice || '',
    exceptionClaimed: !!d.exceptionClaimed,
    exceptionReason: String(d.exceptionReason || '').trim(),
    advanceWanted: !!d.advanceWanted,
    payoutMethod: d.payoutMethod === 'bank' ? 'bank' : 'bkash',
    bankName: String(d.bankName || '').trim(),
    bankAccountName: String(d.bankAccountName || '').trim(),
    bankAccountNumber: String(d.bankAccountNumber || '').trim(),
    bankRoutingNumber: String(d.bankRoutingNumber || '').trim(),
    bankBranch: String(d.bankBranch || '').trim(),
    destination: d.destination || '',
    startTime: d.startTime || '',
    endTime: d.endTime || '',
    workedAt: d.workedAt || '',
    arrangement: d.arrangement === 'company' ? 'company' : 'self',
    transportMode: d.transportMode || '',
    vehicleType: d.vehicleType || '',
    carSpecialApproval: !!d.carSpecialApproval,
    travelFrom: d.travelFrom || '',
    travelTo: d.travelTo || '',
    totalKM: n(d.totalKM),
    legs: (Array.isArray(d.legs) ? d.legs : []).map((l) => ({
      travelDate: l.travelDate || '',
      mode: l.mode || '',
      travelFrom: l.travelFrom || '',
      travelTo: l.travelTo || '',
      amount: n(l.amount),
      note: l.note || '',
    })),
    officeMealTaken: !!d.officeMealTaken,
    dualWorkstation: !!d.dualWorkstation,
    dualWorkstationType: d.dualWorkstationType || '',
    accommodationType:
      d.accommodationType === 'hotel' || d.accommodationType === 'personal'
        ? d.accommodationType
        : '',
    hotelName: d.hotelName || '',
    checkIn: d.checkIn || '',
    checkOut: d.checkOut || '',
    accommodationAmount: n(d.accommodationAmount),
    rentACarAmount: n(d.rentACarAmount),
    rentACarHeadcount: n(d.rentACarHeadcount),
    flightAmount: n(d.flightAmount),
    otherAmount: n(d.otherAmount),
    otherNote: d.otherNote || '',
    advanceType:
      d.advanceType === 'full' || d.advanceType === 'partial'
        ? d.advanceType
        : '',
    advanceRequested: n(d.advanceRequested),
    bkashNumber: String(d.bkashNumber || '').trim(),
    documentTypes: Array.isArray(d.documentTypes)
      ? d.documentTypes.filter(Boolean)
      : [],
    documentLinks: parseLinks(d.documentLinks),
    employeeNote: d.employeeNote || '',
  };
}

/** Builds the full request record from a draft plus the computed amounts. */
export function buildRecord(
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
    status: base.status ?? 'draft',
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
    teamSize: draft.travelType === 'team' ? draft.teamMembers.length + 1 : 1,
    teamMembers: draft.travelType === 'team' ? draft.teamMembers : [],
    fromDate: draft.fromDate,
    toDate: draft.toDate || draft.fromDate,
    tripDays: computation.tripDays,
    purpose: draft.purpose,
    destinationType: draft.destinationType,
    tripDirection: draft.tripDirection,
    route: draft.route,
    dhakaOffice: draft.dhakaOffice,
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
    // Mode is picked per trip now — this is just the first trip's, standing
    // in wherever a single "the mode" is still wanted (the register, a CSV).
    transportMode: draft.legs[0]?.mode || draft.transportMode,
    // For a personal-vehicle leg this is the approved registration's type,
    // not whatever the client sent — the client only ever displays it now.
    vehicleType: draft.legs.some((l) => l.mode === 'PersonalVehicle')
      ? session.registeredVehicle?.vehicleType || draft.vehicleType
      : draft.vehicleType,
    carSpecialApproval: draft.carSpecialApproval,
    travelFrom: draft.travelFrom,
    travelTo: draft.travelTo,
    totalKM: draft.totalKM,
    fuelRate: draft.legs.some((l) => l.mode === 'PersonalVehicle')
      ? (personalVehicleRateFor(policy, session) ?? 0)
      : 0,
    legs: draft.legs,
    taAmount: computation.taAmount,
    perDiemDays: computation.perDiemDays,
    perDiemAmount: computation.perDiemAmount,
    lunchAllowance: computation.lunchAllowance,
    officeMealTaken: draft.dualWorkstation ? true : draft.officeMealTaken,
    dualWorkstation: draft.dualWorkstation,
    dualWorkstationType: draft.dualWorkstationType,
    accommodationType: draft.accommodationType,
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
    advanceType: draft.advanceType,
    advanceRequested: computation.advanceRequested,
    bkashNumber: draft.bkashNumber,
    advanceApproved: base.advanceApproved ?? 0,
    advanceStatus:
      computation.advanceRequested > 0 ? base.advanceStatus || 'pending' : '',
    settlementDueDate:
      computation.advanceRequested > 0
        ? addBusinessDays(
            draft.toDate || draft.fromDate,
            cfgNum(policy, 'ADVANCE_SETTLEMENT_DAYS', 3),
          )
        : '',
    settledAmount: base.settledAmount ?? 0,
    settledAt: base.settledAt ?? '',
    finalPayable: computation.finalPayable,
    managerId: base.managerId ?? '',
    managerEmail: base.managerEmail ?? '',
    submittedAt: base.submittedAt ?? '',
    completedAt: base.completedAt ?? '',
    documentTypes: draft.documentTypes,
    documentLinks: draft.documentLinks,
    policyNotes: computation.notes.join(' | '),
    employeeNote: draft.employeeNote,
    paymentMode: base.paymentMode ?? '',
    transactionId: base.transactionId ?? '',
    paymentDate: base.paymentDate ?? '',
    paidAmount: base.paidAmount ?? 0,
    paidBy: base.paidBy ?? '',
    paymentAck: base.paymentAck ?? '',
    paymentAckAt: base.paymentAckAt ?? '',
    paymentAckNote: base.paymentAckNote ?? '',
    approvedAmount: base.approvedAmount ?? 0,
    approvedAmountBy: base.approvedAmountBy ?? '',
    approvedAmountAt: base.approvedAmountAt ?? '',
    approvedAmountNote: base.approvedAmountNote ?? '',
    companyTransportAmount: base.companyTransportAmount ?? 0,
    companyAccommodationAmount: base.companyAccommodationAmount ?? 0,
    companyAmountsBy: base.companyAmountsBy ?? '',
    companyAmountsAt: base.companyAmountsAt ?? '',
    linkedTo: base.linkedTo ?? '',
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
export async function ensureUniqueRequestId(
  record: RequestRecord,
  rowNumber: number,
  prefix: string,
): Promise<RequestRecord> {
  if (!rowNumber) return record;
  const rows = await readTab('Requests');
  const clashes = rows
    .filter((r) => r.request_id === record.requestId)
    .map((r) => Number(r._row))
    .sort((a, b) => a - b);
  if (clashes.length <= 1 || clashes[0] === rowNumber) return record;

  const year = new Date().getFullYear();
  const highest = rows.reduce((max, r) => {
    const n = Number(String(r.request_id || '').split('-')[2]) || 0;
    return n > max ? n : max;
  }, 0);
  // Each loser offsets by its position, so two of them cannot pick the same one.
  const rank = clashes.indexOf(rowNumber);
  const fixed: RequestRecord = {
    ...record,
    requestId: `${prefix}-${year}-${String(highest + rank).padStart(6, '0')}`,
  };
  await updateRow('Requests', rowNumber, fromRequest(fixed));
  console.warn(
    `[requests] ${record.requestId} was taken concurrently — reissued as ${fixed.requestId}`,
  );
  return fixed;
}

/** This employee's vehicle, if HR or Admin has approved one — never a pending or rejected one. */
export async function approvedVehicleFor(
  employeeId: string,
): Promise<SessionUser['registeredVehicle']> {
  const rows = await readTab('Vehicles');
  const row = rows
    .map(toVehicle)
    .find((v) => v.employeeId === employeeId && v.status === 'approved');
  return row
    ? {
        vehicleType: row.vehicleType,
        model: row.model,
        fuelType: row.fuelType,
        mileageKmPerLitre: row.mileageKmPerLitre,
      }
    : undefined;
}

/**
 * The session as the sheet has it right now.
 *
 * A late-claim unlock is granted after the token was signed, so trusting the
 * token would keep the window shut until the person signed in again.
 */
export async function currentSession(session: Session): Promise<Session> {
  const row = (await allEmployees()).find(
    (e) => e.employeeId === session.employeeId,
  );
  const blocked = await insideCityBlockedEmails();
  return {
    ...session,
    // Whatever HR/Admin can edit on this person's row, or the person
    // themselves (their own bKash number) — trusting the token here would
    // keep every one of these stuck at whatever they were at sign-in.
    ...(row && {
      name: row.name,
      email: row.email,
      gender: row.gender,
      band: row.band,
      department: row.department,
      designation: row.designation,
      lineManagerId: row.lineManagerId,
      roles: row.roles,
      paymentMethod: row.paymentMethod,
      accountNumber: row.accountNumber,
      claimUnlockFrom: row.claimUnlockFrom || '',
      claimUnlockExact: row.claimUnlockExact || '',
    }),
    insideCityBlocked: blocked.has(
      (row?.email || session.email || '').toLowerCase(),
    ),
    registeredVehicle: await approvedVehicleFor(session.employeeId),
  };
}

/**
 * Claims still waiting for this person to confirm they were paid.
 *
 * An unanswered claim is how a wrong account number stays invisible, so a new
 * one waits until the last is closed off. Drafts are exempt — only submitting
 * is blocked.
 */
export async function awaitingAcknowledgement(
  employeeId: string,
): Promise<string[]> {
  const rows = await readTab('Requests');
  return (
    rows
      .map(toRequest)
      // A team-child record is invisible to the teammate it's under and never
      // shows them a "did you get paid" prompt, so it can't be what's blocking
      // them either.
      .filter(
        (r) =>
          r.employeeId === employeeId &&
          r.status === 'paid' &&
          !r.paymentAck &&
          !r.linkedTo,
      )
      .map((r) => r.requestId)
  );
}

/**
 * A team claim's payout, split off into one independent record per
 * teammate — see teamPayoutSplit. Everything about the trip is copied over
 * for context; what's genuinely theirs (identity, bKash number, their own
 * share) replaces the requester's. It mirrors the main record's status
 * automatically (see the cascade in the action handler) and is invisible
 * to the teammate it's under — canView/canActOn gate on `linkedTo`.
 */
export function childFromMain(
  main: RequestRecord,
  member: TeamMember,
  amount: number,
  requestId: string,
  now: string,
): RequestRecord {
  return {
    ...main,
    requestId,
    employeeId: member.employeeId,
    employeeName: member.name,
    email: '',
    band: member.band,
    department: member.department,
    designation: member.designation,
    bkashNumber: member.bkashNumber,
    travelType: 'individual',
    teamMembers: [],
    teamSize: 1,
    totalClaim: money(amount),
    finalPayable: money(amount),
    // The advance was disbursed to the requester alone, so it has nothing to
    // do with a teammate's own share.
    advanceRequested: 0,
    advanceApproved: 0,
    advanceStatus: '',
    settlementDueDate: '',
    settledAmount: 0,
    settledAt: '',
    createdAt: now,
    updatedAt: now,
    submittedAt: now,
    completedAt: '',
    linkedTo: main.requestId,
    paymentMode: '',
    transactionId: '',
    paymentDate: '',
    paidAmount: 0,
    paidBy: '',
    paymentAck: '',
    paymentAckAt: '',
    paymentAckNote: '',
    approvedAmount: 0,
    approvedAmountBy: '',
    approvedAmountAt: '',
    approvedAmountNote: '',
  };
}

export const NEXT_STATUS: Record<string, Status> = {
  manager_review: 'admin_review',
  admin_review: 'finance_review',
  finance_review: 'payment_processing',
};

/**
 * Which advance step, if any, this person may take on this request. Keeps the
 * approval rules on the server: the Department Head is whoever sits one level
 * above the requester's line manager, so it differs per request.
 */
export async function advanceStepFor(
  session: Session,
  r: RequestRecord,
): Promise<{ action: string; label: string } | null> {
  if (!r.advanceRequested || r.settledAt) return null;
  if (r.advanceStatus === 'approved') {
    return hasRole(session, 'finance', 'hr', 'admin')
      ? { action: 'settle', label: 'Record settlement' }
      : null;
  }
  if (r.advanceStatus === 'awaiting_dept_head') {
    const head = await deptHeadIdFor(r.employeeId);
    if (session.employeeId !== head && !hasRole(session, 'admin')) return null;
    return {
      action: 'dept_head_approve',
      label: head ? 'Department Head approval' : 'Administration approval',
    };
  }
  if (r.advanceStatus === 'manager_approved') {
    return hasRole(session, 'hr', 'admin')
      ? { action: 'hr_approve', label: 'HR approval' }
      : null;
  }
  return null;
}
