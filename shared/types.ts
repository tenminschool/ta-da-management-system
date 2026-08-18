/** Types shared by the Express API and the React client. */

export type Scope = "inside" | "outside";
export type ClaimType = "ta" | "perdiem" | "both";
export type TravelType = "individual" | "team";
export type Arrangement = "company" | "self";

export type Status =
  | "draft"
  | "manager_review"
  | "admin_review"
  | "finance_review"
  | "payment_processing"
  | "paid"
  | "completed"
  | "payment_disputed"
  | "returned"
  | "rejected";

export const STATUS_LABEL: Record<Status, string> = {
  draft: "Draft",
  manager_review: "Under Manager Review",
  admin_review: "Under Admin Review",
  finance_review: "Under Finance Review",
  payment_processing: "Payment Processing",
  paid: "Paid — confirm receipt",
  payment_disputed: "Payment Not Received",
  completed: "Completed",
  returned: "Returned for Correction",
  rejected: "Rejected",
};

/**
 * The buckets the dashboard counts and the lists filter by.
 *
 * One definition for both, so a card's number and the list it opens can never
 * disagree — clicking "Returned: 3" has to land on exactly three claims.
 */
export const STATUS_GROUPS = {
  pending: { label: "Pending", statuses: ["manager_review", "admin_review", "finance_review"] },
  approved: { label: "Approved", statuses: ["payment_processing", "paid", "payment_disputed", "completed"] },
  rejected: { label: "Rejected", statuses: ["rejected"] },
  returned: { label: "Returned", statuses: ["returned"] },
  paymentPending: { label: "Payment Pending", statuses: ["payment_processing", "payment_disputed"] },
  paid: { label: "Paid", statuses: ["paid", "completed"] },
} as const satisfies Record<string, { label: string; statuses: readonly Status[] }>;

export type StatusGroup = keyof typeof STATUS_GROUPS;

export const STATUS_PROGRESS: Record<Status, number> = {
  draft: 0,
  manager_review: 20,
  admin_review: 40,
  finance_review: 60,
  payment_processing: 80,
  paid: 92,
  payment_disputed: 85,
  completed: 100,
  returned: 10,
  rejected: 100,
};

/** Ordered stages used to draw the tracking timeline. */
export const TRACK_STAGES: { key: Status; label: string; column: StageKey }[] = [
  { key: "manager_review", label: "Manager Review", column: "Manager" },
  { key: "admin_review", label: "Admin Review", column: "Admin" },
  { key: "finance_review", label: "Finance Review", column: "Finance" },
  { key: "payment_processing", label: "Payment", column: "Payment" },
];

/** Column-group prefixes in the one-row-per-request Approvals tab. */
export type StageKey = "Manager" | "Admin" | "Finance" | "Payment";

/**
 * The only four roles. `user` means "can raise and track their own claims" and
 * everyone has it — the sheet only names the extra desk someone sits at, so a
 * finance person's cell reads just `finance`, not `user,finance`.
 *
 * Line manager and department head are NOT roles: both are derived from the
 * line_manager_id column, so the hierarchy is maintained in one place only.
 */
export type Role = "user" | "admin" | "hr" | "finance";

export interface SessionUser {
  employeeId: string;
  name: string;
  email: string;
  gender: string;
  band: string;
  department: string;
  designation: string;
  lineManagerId: string;
  roles: Role[];
  paymentMethod: string;
  accountNumber: string;
  /** Set by an administrator: the earliest travel date this person may now file a late claim for. */
  claimUnlockFrom?: string;
  /**
   * Derived, not stored: true when at least one active employee lists this
   * person as their line manager. Recomputed on every sign-in and /me, so
   * pointing a report at a new manager takes effect immediately.
   */
  managesOthers?: boolean;
  /**
   * This person's own vehicle, once HR or Admin has approved it — never set
   * from a pending or rejected registration. Read fresh from the Vehicles tab
   * at every claim computation, the same way claimUnlockFrom is, so an
   * approval takes effect without signing in again.
   */
  registeredVehicle?: { vehicleType: "Bike" | "Car"; model: string; fuelType: string; mileageKmPerLitre: number };
}

/** One employee's vehicle, submitted for HR/Admin approval before it can be claimed against. */
export interface VehicleRegistration {
  employeeId: string;
  employeeName: string;
  vehicleType: "Bike" | "Car";
  model: string;
  fuelType: string;
  mileageKmPerLitre: number;
  /** A photo of the vehicle with its number plate visible — proof of ownership. */
  imageLink: string;
  status: "pending" | "approved" | "rejected";
  submittedAt: string;
  reviewedBy: string;
  reviewedAt: string;
  reviewNote: string;
}

/**
 * A claim window exception, asked for from the New Request form ("Contact
 * HR") instead of the employee having to be told to go find someone —
 * Admin/HR decide it, and approving writes straight to the same
 * claimUnlockFrom the Configuration form sets by hand.
 */
export interface UnlockRequest {
  requestId: string;
  employeeId: string;
  employeeName: string;
  department: string;
  reason: string;
  /** The date they said they need — Admin/HR can grant a different one. */
  requestedFrom: string;
  submittedAt: string;
  status: "pending" | "approved" | "rejected";
  decidedBy: string;
  decidedAt: string;
  decisionRemarks: string;
  /** Set once approved — the date actually granted. */
  unlockFrom: string;
}

/** How an approved claim is paid out. */
export type PayoutMethod = "bkash" | "bank";

export interface TeamMember {
  employeeId: string;
  name: string;
  department: string;
  designation: string;
  band: string;
  /** Drives transport eligibility for the whole party. */
  gender: string;
  /** Where this person's share of the payment goes. */
  bkashNumber: string;
  /**
   * Inside-city only: whether THIS person got a company-provided meal —
   * asked per traveller on a team claim, since it is not always the same
   * answer for everyone on the trip.
   */
  officeMealTaken: boolean;
  /**
   * Company Arrangement only: what this person's own transport/accommodation
   * actually cost, logged by HR/Admin after the fact — e.g. one traveller
   * staying an extra night. Always 0 on a freshly-submitted claim; reporting
   * only, never payable.
   */
  companyTransportAmount: number;
  companyAccommodationAmount: number;
}

export interface Leg {
  travelDate: string;
  mode: string;
  travelFrom: string;
  travelTo: string;
  amount: number;
  note: string;
}

export interface RequestDraft {
  requestId?: string;
  scope: Scope;
  city: string;
  claimType: ClaimType;
  travelType: TravelType;
  teamMembers: TeamMember[];
  fromDate: string;
  toDate: string;
  purpose: string;
  /** Kind of place visited on an inside-city trip — a DestinationType value. */
  destinationType: string;
  /**
   * Inside-city only: whether the trip back to the office is being claimed
   * too. "two_way" implies a second leg, office to destination reversed, so
   * the fare is entered and reimbursed for both directions.
   */
  tripDirection: "one_way" | "two_way" | "more_ways";
  /** Outside-city route taken — a Route value. Empty on inside-city trips. */
  route: string;
  /** Which Dhaka office the trip is to/from, whenever the route touches Dhaka. */
  dhakaOffice: string;
  /** Transport taken outside band policy, with the reason it had to be. */
  exceptionClaimed: boolean;
  exceptionReason: string;
  /** Whether an eligible traveller actually wants the advance. */
  advanceWanted: boolean;
  /** Where the payment goes. Bank is only offered when ALLOW_BANK_PAYOUT is on. */
  payoutMethod: PayoutMethod;
  bankName: string;
  bankAccountName: string;
  bankAccountNumber: string;
  bankRoutingNumber: string;
  bankBranch: string;
  destination: string;
  startTime: string;
  endTime: string;
  workedAt: string;
  arrangement: Arrangement;
  transportMode: string;
  vehicleType: string;
  carSpecialApproval: boolean;
  travelFrom: string;
  travelTo: string;
  totalKM: number;
  legs: Leg[];
  officeMealTaken: boolean;
  dualWorkstation: boolean;
  dualWorkstationType: string;
  /** Outside-city only: a personal stay has no hotel bill, so nothing to claim. */
  accommodationType: "hotel" | "personal" | "";
  hotelName: string;
  checkIn: string;
  checkOut: string;
  accommodationAmount: number;
  rentACarAmount: number;
  rentACarHeadcount: number;
  flightAmount: number;
  otherAmount: number;
  otherNote: string;
  /** "full" pays out the whole claim up front; "partial" is typed in by hand. */
  advanceType: "full" | "partial" | "";
  advanceRequested: number;
  /** Where the employee wants the money sent. */
  bkashNumber: string;
  /** Multi-select: which kinds of document the links below cover. */
  documentTypes: string[];
  /** Google Drive (or any) links, one per entry. */
  documentLinks: string[];
  employeeNote: string;
}

export interface BandPolicy {
  band: string;
  modesMale: string[];
  modesFemale: string[];
  outsideTAWeekday: number;
  outsideTAWeekend: number;
  accommodationLimit: number;
  flightEligible: boolean;
  carPoolEligible: boolean;
}

export interface TransportModeSpec {
  mode: string;
  label: string;
  requiresReceipt: boolean;
  scope: "Inside" | "Outside" | "Both";
}

export interface Policy {
  config: Record<string, string>;
  bands: BandPolicy[];
  cities: { city: string; zone: "Inside" | "Outside" }[];
  modes: TransportModeSpec[];
  workedAtOptions: string[];
  /**
   * Inside-city destinations. `needs` decides what the form asks for next;
   * `cities` limits the option to those cities, empty meaning everywhere.
   */
  destinationTypes: { value: string; label: string; needs: "name" | "office" | "purpose"; cities: string[] }[];
  otherOffices: string[];
  /** Outside-city routes. A blank `to` means the traveller types the city. */
  routes: { value: string; label: string; from: string; to: string }[];
  dualWorkstationOptions: string[];
  paymentMethods: string[];
  documentTypes: string[];
  /** What Administration currently pays per litre, by fuel type. */
  fuelTypes: { value: string; label: string; pricePerLitre: number }[];
  approvalFlow: { step: number; stage: string; label: string; roleRequired: string }[];
}

export interface Computation {
  /** Derived from what the policy paid, never chosen by the claimant. */
  claimType: ClaimType;
  workingHours: number;
  tripDays: number;
  weekdayDays: number;
  weekendDays: number;
  taAmount: number;
  perDiemEligible: boolean;
  perDiemDays: number;
  perDiemAmount: number;
  lunchEligible: boolean;
  lunchAllowance: number;
  accommodationAmount: number;
  accommodationLimit: number;
  rentACarAmount: number;
  flightAmount: number;
  otherAmount: number;
  totalClaim: number;
  advanceRequested: number;
  finalPayable: number;
  advanceAvailable: boolean;
  /** Whether enough notice has been given for Company Arrangement / an advance. */
  noticeOK: boolean;
  /** Business days' notice actually given, and the threshold it is judged against. */
  noticeGiven: number;
  noticeDaysRequired: number;
  /** Whether the chosen mode or an entered cost actually issues a receipt. */
  needsReceipt: boolean;
  requiresDeptHeadApproval: boolean;
  notes: string[];
  errors: string[];
  warnings: string[];
}

/** One request = one row in the Requests tab. */
export interface RequestRecord {
  requestId: string;
  createdAt: string;
  updatedAt: string;
  status: Status;
  employeeId: string;
  employeeName: string;
  email: string;
  band: string;
  department: string;
  designation: string;
  scope: Scope;
  city: string;
  claimType: ClaimType;
  travelType: TravelType;
  teamSize: number;
  teamMembers: TeamMember[];
  fromDate: string;
  toDate: string;
  tripDays: number;
  purpose: string;
  destinationType: string;
  tripDirection: "one_way" | "two_way" | "more_ways";
  route: string;
  dhakaOffice: string;
  exceptionClaimed: boolean;
  exceptionReason: string;
  advanceWanted: boolean;
  payoutMethod: PayoutMethod;
  bankName: string;
  bankAccountName: string;
  bankAccountNumber: string;
  bankRoutingNumber: string;
  bankBranch: string;
  destination: string;
  startTime: string;
  endTime: string;
  workingHours: number;
  workedAt: string;
  arrangement: Arrangement;
  transportMode: string;
  vehicleType: string;
  carSpecialApproval: boolean;
  travelFrom: string;
  travelTo: string;
  totalKM: number;
  fuelRate: number;
  legs: Leg[];
  taAmount: number;
  perDiemDays: number;
  perDiemAmount: number;
  lunchAllowance: number;
  officeMealTaken: boolean;
  dualWorkstation: boolean;
  dualWorkstationType: string;
  accommodationType: "hotel" | "personal" | "";
  hotelName: string;
  checkIn: string;
  checkOut: string;
  accommodationAmount: number;
  rentACarAmount: number;
  rentACarHeadcount: number;
  flightAmount: number;
  otherAmount: number;
  otherNote: string;
  totalClaim: number;
  advanceType: "full" | "partial" | "";
  advanceRequested: number;
  bkashNumber: string;
  advanceApproved: number;
  advanceStatus: string;
  settlementDueDate: string;
  settledAmount: number;
  settledAt: string;
  finalPayable: number;
  managerId: string;
  managerEmail: string;
  submittedAt: string;
  completedAt: string;
  documentTypes: string[];
  documentLinks: string[];
  policyNotes: string;
  employeeNote: string;
  paymentMode: string;
  transactionId: string;
  paymentDate: string;
  paidAmount: number;
  paidBy: string;
  /** "" until the employee answers, then "received" or "not_received". */
  paymentAck: string;
  paymentAckAt: string;
  paymentAckNote: string;
  /**
   * What an approver decided to pay, when that differs from what was claimed.
   * 0 means nobody changed it — the claim stands as submitted.
   */
  approvedAmount: number;
  approvedAmountBy: string;
  approvedAmountAt: string;
  approvedAmountNote: string;
  /**
   * Company Arrangement travel is paid by the company directly, so the
   * employee never enters a transport or hotel figure — HR/Admin can log
   * what it actually cost here, for reporting only. It does not change what
   * is payable to the employee.
   */
  companyTransportAmount: number;
  companyAccommodationAmount: number;
  companyAmountsBy: string;
  companyAmountsAt: string;
  /**
   * Set only on a team-travel child record — the requestId of the "main"
   * request it was split off from. A child carries one teammate's own share
   * (bkashNumber, finalPayable, totalClaim already reduced to just their
   * cut) so Finance can pay and reconcile it independently; it mirrors the
   * main record's status automatically and is never acted on directly, and
   * it's invisible to the teammate it's under — Finance/Admin/HR only.
   */
  linkedTo: string;
}

/** One request = one row in the Approvals tab, with a column group per desk. */
export interface ApprovalRow {
  requestId: string;
  employeeName: string;
  currentStage: string;
  submittedAt: string;
  submittedRemarks: string;
  managerStatus: string;
  managerBy: string;
  managerAt: string;
  managerRemarks: string;
  adminStatus: string;
  adminBy: string;
  adminAt: string;
  adminRemarks: string;
  financeStatus: string;
  financeBy: string;
  financeAt: string;
  financeRemarks: string;
  paymentStatus: string;
  paymentBy: string;
  paymentAt: string;
  paymentRemarks: string;
  advanceHRStatus: string;
  advanceHRBy: string;
  advanceHRAt: string;
  advanceDeptHeadStatus: string;
  advanceDeptHeadBy: string;
  advanceDeptHeadAt: string;
  lastAction: string;
  lastActionAt: string;
}

