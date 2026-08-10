/**
 * Google-Sheet schema for the TA & Per-Diem system.
 *
 * Six tabs, and one row per record — a request never spreads across rows.
 * Trips, team members, document links, payment and advance details all live in
 * their own columns on the request's single row; every approval desk gets a
 * column group on the request's single Approvals row. All the small dropdown
 * lists share one `Lists` tab instead of a tab each.
 *
 * Column order IS the contract: rows are read/written positionally against
 * `headers`, so `npm run setup` and the server can never disagree.
 */

export interface TabSpec {
  title: string;
  headers: string[];
  /** Rows written once, only when the tab has no data. */
  seed?: (string | number)[][];
  color: { red: number; green: number; blue: number };
  /** Column widths in px, applied left to right. */
  widths?: number[];
}

const BLUE = { red: 0.16, green: 0.42, blue: 0.82 };
const GREEN = { red: 0.13, green: 0.55, blue: 0.36 };
const AMBER = { red: 0.85, green: 0.6, blue: 0.13 };
const SLATE = { red: 0.35, green: 0.4, blue: 0.47 };

/** Seniority order, most senior first. */
export const BAND_ORDER = ["A", "B", "C", "D", "E1", "E2", "F", "G"];

/** Tabs from the previous, sprawling layout. `npm run setup` removes them. */
export const OBSOLETE_TABS = [
  "RequestLegs", "TeamMembers", "Payments", "Advances", "Documents", "DocumentChunks",
  "Cities", "TransportModes", "ApprovalFlow", "WorkedAtOptions", "DualWorkstationOptions",
  "PaymentMethods", "Notifications",
];

export const TABS: TabSpec[] = [
  // ── People ────────────────────────────────────────────────────────────────
  {
    title: "Employees",
    color: BLUE,
    widths: [230, 110, 170, 240, 100, 90, 70, 150, 180, 130, 210, 130, 150, 90],
    headers: [
      // Written on first SSO sign-in: the identity provider's stable subject id.
      "auth_id",
      "employee_id", "name", "email", "password", "gender", "band",
      "department", "designation", "line_manager_id", "roles",
      "payment_method", "account_number", "status",
      // Set by an administrator to let this person file a late claim: they may
      // submit past the window until the end of this date.
      "claim_unlock_until",
    ],
    seed: [
      ["", "EMP-1001", "Ariful Islam", "ariful@10ms.com", "1234", "Male", "G", "Sales", "Sales Executive", "EMP-1005", "user", "bKash", "01700000001", "Active"],
      ["", "EMP-1002", "Nusrat Jahan", "nusrat@10ms.com", "1234", "Female", "F", "Academic", "Content Producer", "EMP-1005", "user", "bKash", "01700000002", "Active"],
      ["", "EMP-1003", "Tanvir Ahmed", "tanvir@10ms.com", "1234", "Male", "D", "Operations", "Manager, Operations", "EMP-1006", "user", "Bank", "1234500001", "Active"],
      ["", "EMP-1004", "Sadia Rahman", "sadia@10ms.com", "1234", "Female", "E2", "Marketing", "Marketing Associate", "EMP-1003", "user", "Nagad", "01700000004", "Active"],
      ["", "EMP-1005", "Rakib Hasan", "rakib@10ms.com", "1234", "Male", "C", "Sales", "Head of Sales", "EMP-1006", "user", "Bank", "1234500002", "Active"],
      ["", "EMP-1006", "Farhana Akter", "farhana@10ms.com", "1234", "Female", "B", "PeopleOps", "Director, PeopleOps", "", "hr", "Bank", "1234500003", "Active"],
      ["", "EMP-2001", "Admin Desk", "admin@10ms.com", "1234", "Male", "D", "Administration", "Admin Officer", "EMP-1006", "admin", "Bank", "1234500004", "Active"],
      // The roles column names only the extra desk someone sits at: admin, hr
      // or finance. Everyone can raise a claim regardless, so plain staff are
      // just "user". Line manager is not written here either — it comes from
      // line_manager_id, so Rakib (EMP-1005) automatically approves for
      // everyone pointing at him.
      ["", "EMP-3001", "Nafisa Karim", "finance@10ms.com", "1234", "Female", "D", "Finance", "Finance Officer", "EMP-1006", "finance", "Bank", "1234500005", "Active"],
      ["", "EMP-3002", "Mahin Chowdhury", "finance2@10ms.com", "1234", "Male", "E1", "Finance", "Finance Executive", "EMP-1006", "finance", "Bank", "1234500007", "Active"],
      ["", "EMP-4001", "Shirin Akhter", "hr@10ms.com", "1234", "Female", "C", "PeopleOps", "HR Business Partner", "EMP-1006", "hr", "Bank", "1234500006", "Active"],
      ["", "EMP-4002", "Sumaiya Islam", "hr2@10ms.com", "1234", "Female", "E1", "PeopleOps", "HR Executive", "EMP-1006", "hr", "Bank", "1234500008", "Active"],
    ],
  },

  // ── One row per request ───────────────────────────────────────────────────
  {
    title: "Requests",
    color: GREEN,
    widths: [150, 150, 150, 150, 110, 160, 210, 70, 140, 160, 100, 130, 110, 110, 80, 260],
    headers: [
      "request_id", "created_at", "updated_at", "status",
      "employee_id", "employee_name", "email", "band", "department", "designation",
      "scope", "city", "claim_type", "travel_type", "team_size", "team_members",
      "from_date", "to_date", "trip_days", "purpose", "destination",
      "start_time", "end_time", "working_hours", "worked_at",
      "arrangement", "transport_mode", "vehicle_type", "car_special_approval",
      "travel_from", "travel_to", "total_km", "fuel_rate", "trips",
      "ta_amount", "per_diem_days", "per_diem_amount", "lunch_allowance",
      "worked_during_lunch", "office_meal_taken", "dual_workstation", "dual_workstation_type",
      "hotel_name", "check_in", "check_out", "accommodation_amount",
      "rent_a_car_amount", "rent_a_car_headcount", "flight_amount", "other_amount", "other_note",
      "total_claim",
      "advance_requested", "advance_approved", "advance_status",
      "settlement_due_date", "settled_amount", "settled_at",
      "final_payable", "manager_id", "manager_email", "submitted_at", "completed_at",
      "document_types", "document_links",
      "payment_mode", "transaction_id", "payment_date", "paid_amount", "paid_by",
      "policy_notes", "employee_note",
      // New columns go at the END. Rows are positional, so inserting one in the
      // middle shifts every value after it into the wrong column.
      "bkash_number",
      "destination_type",
      "route",
      "exception_claimed", "exception_reason", "advance_wanted",
      "payout_method", "bank_name", "bank_account_name", "bank_account_number",
      "bank_routing_number", "bank_branch",
      "payment_ack", "payment_ack_at", "payment_ack_note",
      "approved_amount", "approved_amount_by", "approved_amount_at", "approved_amount_note",
      "trip_direction",
    ],
  },

  // ── One row per request, one column group per desk ────────────────────────
  {
    title: "Approvals",
    color: AMBER,
    widths: [150, 170, 170, 160, 240, 110, 170, 160, 260, 110, 170, 160, 260, 110, 170, 160, 260, 110, 170, 160, 260],
    headers: [
      "request_id", "employee_name", "current_stage", "submitted_at", "submitted_remarks",
      "manager_status", "manager_by", "manager_at", "manager_remarks",
      "admin_status", "admin_by", "admin_at", "admin_remarks",
      "finance_status", "finance_by", "finance_at", "finance_remarks",
      "payment_status", "payment_by", "payment_at", "payment_remarks",
      "advance_hr_status", "advance_hr_by", "advance_hr_at",
      "advance_dept_head_status", "advance_dept_head_by", "advance_dept_head_at",
      "last_action", "last_action_at",
    ],
  },


  // ── Admin-configurable policy ─────────────────────────────────────────────
  {
    title: "Config",
    color: SLATE,
    widths: [260, 120, 470, 130],
    headers: ["key", "value", "description", "effective_from"],
    seed: [
      ["PER_DIEM_AMOUNT", 250, "Per-Diem amount (BDT) when working hours >= threshold", "2026-01-01"],
      ["PER_DIEM_MIN_HOURS", 5, "Minimum working hours to qualify for Per-Diem", "2026-01-01"],
      ["LUNCH_ALLOWANCE", 150, "Lunch allowance (BDT) when hours < threshold but worked through lunch", "2026-01-01"],
      ["LUNCH_WINDOW_START", "13:00", "Start of the office lunch window", "2026-01-01"],
      ["LUNCH_WINDOW_END", "15:00", "End of the office lunch window", "2026-01-01"],
      ["FUEL_RATE_BIKE", 3, "Reimbursement per KM for a personal bike (BDT/km)", "2026-01-01"],
      ["FUEL_RATE_CAR", 10, "Reimbursement per KM for a personal car (BDT/km)", "2026-01-01"],
      ["TEAM_CAR_MIN_MEMBERS", 3, "Minimum team size before Car becomes selectable for team travel", "2026-01-01"],
      ["RENT_A_CAR_LIMIT", 6000, "Maximum rent-a-car cost (BDT) one way", "2026-01-01"],
      ["RENT_A_CAR_MIN_HEADCOUNT", 3, "Minimum employees required to book a rent-a-car", "2026-01-01"],
      ["ADVANCE_MIN_TRIP_DAYS", 3, "Advance is offered only when trip days exceed this", "2026-01-01"],
      ["ADVANCE_AUTO_LIMIT", 10000, "Advance above this amount also needs Department Head approval", "2026-01-01"],
      ["ADVANCE_SETTLEMENT_DAYS", 3, "Working days after trip end to settle an advance", "2026-01-01"],
      ["COMPANY_ARRANGE_NOTICE_DAYS", 2, "Business days of notice required for company-arranged travel", "2026-01-01"],
      ["REQUIRE_DOCUMENT_LINK", "Yes", "Require at least one document link when money is claimed", "2026-01-01"],
      ["CURRENCY", "BDT", "Display currency", "2026-01-01"],
      ["CLAIM_WINDOW_DAYS", 7, "Days after travel within which a claim must be submitted. An administrator can unlock a late one.", "2026-01-01"],
      ["ALLOW_BANK_PAYOUT", "No", "Yes to let people be paid into a bank account as well as bKash. No pays everyone by bKash.", "2026-01-01"],
      ["REQUEST_ID_PREFIX", "TA", "Prefix used when generating request numbers", "2026-01-01"],
    ],
  },
  {
    title: "BandPolicy",
    color: SLATE,
    widths: [70, 240, 250, 140, 140, 160, 120, 120, 130],
    headers: [
      "band", "modes_male", "modes_female",
      "outside_ta_weekday", "outside_ta_weekend", "accommodation_limit",
      "flight_eligible", "car_pool_eligible", "effective_from",
    ],
    seed: [
      ["A", "Rickshaw,CNG,Car", "Rickshaw,CNG,Car", 1000, 1800, 5000, "Yes", "No", "2026-01-01"],
      ["B", "Rickshaw,CNG,Car", "Rickshaw,CNG,Car", 1000, 1800, 5000, "Yes", "No", "2026-01-01"],
      ["C", "Rickshaw,CNG,Car", "Rickshaw,CNG,Car", 900, 1350, 4000, "No", "Yes", "2026-01-01"],
      ["D", "Rickshaw,CNG,Car", "Rickshaw,CNG,Car", 900, 1350, 4000, "No", "Yes", "2026-01-01"],
      ["E1", "Rickshaw,Bike,CNG", "Rickshaw,Bike,CNG,Car", 900, 1350, 4000, "No", "Yes", "2026-01-01"],
      ["E2", "Rickshaw,Bike,CNG", "Rickshaw,Bike,CNG,Car", 900, 1350, 4000, "No", "Yes", "2026-01-01"],
      ["F", "Rickshaw,Bike,CNG", "Rickshaw,Bike,CNG,Car", 800, 1200, 3000, "No", "Yes", "2026-01-01"],
      ["G", "Rickshaw,Bike,CNG", "Rickshaw,Bike,CNG,Car", 700, 1050, 2000, "No", "Yes", "2026-01-01"],
    ],
  },

  /**
   * Every dropdown list in the product, in one tab. `Extra1` / `Extra2` carry
   * the few attributes a list needs (a city's zone, a transport mode's scope,
   * an approval stage's step and role).
   */
  {
    title: "Lists",
    color: SLATE,
    widths: [180, 190, 240, 130, 130, 90],
    headers: ["list_name", "value", "label", "extra_1", "extra_2", "active"],
    seed: [
      ["City", "Dhaka", "Dhaka", "Inside", "", "Yes"],
      ["City", "Chattogram", "Chattogram", "Inside", "", "Yes"],
      ["City", "Sylhet", "Sylhet", "Outside", "", "Yes"],
      ["City", "Khulna", "Khulna", "Outside", "", "Yes"],
      ["City", "Rajshahi", "Rajshahi", "Outside", "", "Yes"],
      ["City", "Barishal", "Barishal", "Outside", "", "Yes"],
      ["City", "Rangpur", "Rangpur", "Outside", "", "Yes"],
      ["City", "Mymensingh", "Mymensingh", "Outside", "", "Yes"],
      ["City", "Cox's Bazar", "Cox's Bazar", "Outside", "", "Yes"],
      ["City", "Other District", "Other District", "Outside", "", "Yes"],

      // The last column is the on/off switch: turn one back on here and it
      // reappears in the form, no code change needed.
      ["TransportMode", "Rickshaw", "Rickshaw", "Inside", "No", "Yes"],
      ["TransportMode", "Bike", "Bike", "Inside", "No", "Yes"],
      ["TransportMode", "CNG", "CNG", "Inside", "No", "No"],
      ["TransportMode", "Car", "Car", "Inside", "No", "No"],
      ["TransportMode", "CompanyVehicle", "Company Vehicle", "Both", "No", "No"],
      ["TransportMode", "PersonalVehicle", "Personal Vehicle (Own Bike / Car)", "Both", "No", "Yes"],
      // Inside city only — outside-city travel does not offer app-based
      // ride-sharing as an option.
      ["TransportMode", "RideSharing", "Ride Sharing (Uber / Pathao)", "Inside", "Yes", "Yes"],
      ["TransportMode", "Bus", "Bus", "Outside", "Yes", "Yes"],
      ["TransportMode", "Train", "Train", "Outside", "Yes", "Yes"],
      ["TransportMode", "Launch", "Launch", "Outside", "Yes", "Yes"],
      ["TransportMode", "Flight", "Flight", "Outside", "Yes", "Yes"],
      ["TransportMode", "RentACar", "Rent a Car", "Outside", "Yes", "Yes"],

      // Where an inside-city trip went. `Extra1` says what the form asks for
      // next: "Name" opens a free-text box for the place, "Office" opens the
      // OtherOffice list below, "Purpose" asks for nothing beyond the purpose
      // everyone writes anyway. `Extra2` limits an option to the cities named
      // there — blank offers it everywhere, which is what all but one want.
      ["DestinationType", "Partner Office", "Partner Office", "Name", "", "Yes"],
      ["DestinationType", "Stakeholder", "Stakeholder", "Name", "", "Yes"],
      ["DestinationType", "University", "University", "Name", "", "Yes"],
      ["DestinationType", "Vendor", "Vendor", "Name", "", "Yes"],
      // Label only — the stored value stays "Other Office" so claims already
      // filed under it keep validating.
      ["DestinationType", "Other Office", "10MS Office", "Office", "Dhaka", "Yes"],
      ["DestinationType", "Others", "Others", "Purpose", "", "Yes"],

      // Outside-city trips pick a route rather than a bare district. `Extra1`
      // is where it starts, `Extra2` where it ends — blank meaning the traveller
      // types the city, which is what the "Other city" routes are for.
      ["Route", "Dhaka to Chattogram", "Dhaka to Chattogram", "Dhaka", "Chattogram", "Yes"],
      ["Route", "Chattogram to Dhaka", "Chattogram to Dhaka", "Chattogram", "Dhaka", "Yes"],
      ["Route", "Dhaka to Other city", "Dhaka to Other city", "Dhaka", "", "Yes"],
      ["Route", "Chattogram to Other city", "Chattogram to Other city", "Chattogram", "", "Yes"],

      ["OtherOffice", "Mirpur LC", "Mirpur LC", "", "", "Yes"],
      ["OtherOffice", "Uttara LC", "Uttara LC", "", "", "Yes"],
      ["OtherOffice", "Panthapath LC", "Panthapath LC", "", "", "Yes"],
      ["OtherOffice", "Moghbazar LC", "Moghbazar LC", "", "", "Yes"],
      ["OtherOffice", "Mirpur Telesales Office", "Mirpur Telesales Office", "", "", "Yes"],

      ["WorkedAt", "Office", "Office", "", "", "Yes"],
      ["WorkedAt", "Partner Office", "Partner Office", "", "", "Yes"],
      ["WorkedAt", "University", "University", "", "", "Yes"],
      ["WorkedAt", "Vendor", "Vendor", "", "", "Yes"],
      ["WorkedAt", "Stakeholder", "Stakeholder", "", "", "Yes"],
      ["WorkedAt", "Others", "Others", "", "", "Yes"],

      ["DualWorkstation", "HQ Scheduled Day", "HQ Scheduled Day", "", "", "Yes"],
      ["DualWorkstation", "SBM", "SBM", "", "", "Yes"],
      ["DualWorkstation", "Tele Sales", "Tele Sales", "", "", "Yes"],
      ["DualWorkstation", "Shooting", "Shooting", "", "", "Yes"],
      ["DualWorkstation", "Other", "Other", "", "", "Yes"],

      ["PaymentMethod", "Bank", "Bank", "", "", "Yes"],
      ["PaymentMethod", "bKash", "bKash", "", "", "Yes"],
      ["PaymentMethod", "Nagad", "Nagad", "", "", "Yes"],

      ["DocumentType", "Ticket", "Ticket", "", "", "Yes"],
      ["DocumentType", "Bill", "Bill", "", "", "Yes"],
      ["DocumentType", "Receipt", "Receipt", "", "", "Yes"],
      ["DocumentType", "Invoice", "Invoice", "", "", "Yes"],
      ["DocumentType", "Hotel Bill", "Hotel Bill", "", "", "Yes"],
      ["DocumentType", "Ride Sharing Receipt", "Ride Sharing Receipt", "", "", "Yes"],
      ["DocumentType", "Trip Screenshot", "Trip Screenshot", "", "", "Yes"],
      ["DocumentType", "Fuel Calculation", "Fuel Calculation", "", "", "Yes"],
      ["DocumentType", "Approval Mail", "Approval Mail", "", "", "Yes"],
      ["DocumentType", "Supporting Document", "Supporting Document", "", "", "Yes"],

      ["ApprovalStage", "manager_review", "Line Manager", 1, "manager", "Yes"],
      ["ApprovalStage", "admin_review", "Administration", 2, "admin", "Yes"],
      ["ApprovalStage", "finance_review", "Finance", 3, "finance", "Yes"],
      ["ApprovalStage", "payment_processing", "Payment", 4, "finance", "Yes"],
    ],
  },
];

export const TAB = Object.fromEntries(TABS.map((t) => [t.title, t])) as Record<string, TabSpec>;
