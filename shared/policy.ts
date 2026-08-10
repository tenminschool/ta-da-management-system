/**
 * The policy engine.
 *
 * Pure functions only — no I/O — so the Express API and the React client run
 * exactly the same rules. The client uses it to hide ineligible options and
 * preview amounts live; the server re-runs it on submit and is authoritative.
 *
 * Nothing here hard-codes a rate, a limit or a band's transport list: every
 * number comes out of the `Policy` object, which is loaded from the
 * admin-editable Config / BandPolicy tabs.
 */

import type {
  BandPolicy, ClaimType, Computation, Leg, Policy, RequestDraft, Scope, SessionUser,
} from "./types.js";

// ── small helpers ───────────────────────────────────────────────────────────

export function cfgNum(policy: Policy, key: string, fallback: number): number {
  const raw = policy.config[key];
  const n = Number(raw);
  return raw !== undefined && raw !== "" && Number.isFinite(n) ? n : fallback;
}

export function cfgStr(policy: Policy, key: string, fallback = ""): string {
  const raw = policy.config[key];
  return raw === undefined || raw === "" ? fallback : raw;
}

export function money(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function bandPolicy(policy: Policy, band: string): BandPolicy | undefined {
  return policy.bands.find((b) => b.band.toUpperCase() === String(band || "").toUpperCase());
}

/** Bangladesh weekend: Friday and Saturday. */
export function isWeekend(date: string | Date): boolean {
  const d = typeof date === "string" ? new Date(`${date}T00:00:00`) : date;
  if (Number.isNaN(d.getTime())) return false;
  const day = d.getDay();
  return day === 5 || day === 6;
}

/** Inclusive day span between two ISO dates, split into weekday / weekend. */
/** Today, as the plain date the sheet stores. */
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Whole days from one plain date to another; negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00`).getTime();
  const b = new Date(`${to}T00:00:00`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86400000);
}

export function daySpan(fromDate: string, toDate: string): { total: number; weekday: number; weekend: number } {
  const from = new Date(`${fromDate}T00:00:00`);
  const to = new Date(`${toDate || fromDate}T00:00:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) {
    return { total: 0, weekday: 0, weekend: 0 };
  }
  let weekday = 0;
  let weekend = 0;
  const cur = new Date(from);
  while (cur <= to) {
    if (isWeekend(cur)) weekend += 1;
    else weekday += 1;
    cur.setDate(cur.getDate() + 1);
  }
  return { total: weekday + weekend, weekday, weekend };
}

/** Business days (Sun–Thu) strictly between today and a future date. */
export function businessDaysUntil(target: string, from: Date = new Date()): number {
  const end = new Date(`${target}T00:00:00`);
  if (Number.isNaN(end.getTime())) return 0;
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  if (end <= start) return 0;
  let count = 0;
  const cur = new Date(start);
  cur.setDate(cur.getDate() + 1);
  while (cur <= end) {
    if (!isWeekend(cur)) count += 1;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

/** Adds N business days to a date, returning an ISO date string. */
export function addBusinessDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  let left = days;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    if (!isWeekend(d)) left -= 1;
  }
  return d.toISOString().slice(0, 10);
}

/** Decimal hours between two HH:MM times; an end before the start wraps midnight. */
export function workingHours(start: string, end: string): number {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  if ([sh, sm, eh, em].some((v) => !Number.isFinite(v))) return 0;
  let mins = eh * 60 + em - (sh * 60 + sm);
  if (mins < 0) mins += 24 * 60;
  return Math.round((mins / 60) * 100) / 100;
}

/** True when the shift overlaps the configured office lunch window. */
export function coversLunchWindow(policy: Policy, start: string, end: string): boolean {
  const toMin = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : NaN;
  };
  const s = toMin(start);
  const e = toMin(end);
  const ls = toMin(cfgStr(policy, "LUNCH_WINDOW_START", "13:00"));
  const le = toMin(cfgStr(policy, "LUNCH_WINDOW_END", "15:00"));
  if ([s, e, ls, le].some((v) => Number.isNaN(v))) return false;
  return s < le && e > ls;
}

export function fuelRateFor(policy: Policy, vehicleType: string): number {
  return vehicleType === "Car"
    ? cfgNum(policy, "FUEL_RATE_CAR", 10)
    : cfgNum(policy, "FUEL_RATE_BIKE", 3);
}

/** Whether administrators have opened bank payment as an alternative to bKash. */
export function bankPayoutAllowed(policy: Policy): boolean {
  return String(cfgStr(policy, "ALLOW_BANK_PAYOUT", "No")).trim().toLowerCase() === "yes";
}

export function cityZone(policy: Policy, city: string): "Inside" | "Outside" | "" {
  return policy.cities.find((c) => c.city === city)?.zone ?? "";
}

// ── transport eligibility ───────────────────────────────────────────────────

export interface EligibilityContext {
  band: string;
  gender: string;
  scope: Scope;
  travelType: "individual" | "team";
  /** Total travellers including the requester. */
  teamSize: number;
  /** Genders of the other travellers, so the party can be assessed as a whole. */
  teamGenders?: string[];
  /** Transport taken outside band policy because the trip demanded it. */
  exceptionClaimed?: boolean;
  carSpecialApproval: boolean;
}

export interface ModeOption {
  mode: string;
  label: string;
  enabled: boolean;
  /** Why a visible-but-locked option is locked. Empty when enabled. */
  reason: string;
  requiresReceipt: boolean;
}

/**
 * The set of transport options a given employee may pick, already filtered by
 * band, gender and team size. Options the policy forbids outright are dropped;
 * options that merely need an extra condition come back disabled with a reason,
 * so the employee understands the rule instead of hunting for a missing button.
 */
const isFemaleGender = (g: string | undefined): boolean =>
  String(g || "").toLowerCase().startsWith("f");

/**
 * Whether a woman is travelling — as the claimant, or anywhere in the team.
 *
 * Every mode of transport opens for her regardless of band, flight aside, and
 * that holds for the whole party: a team is only as safe as its least safe
 * journey, so one female traveller opens the options for the trip.
 */
export function femaleTravelling(gender: string, travelType: string, teamGenders: string[] = []): boolean {
  if (isFemaleGender(gender)) return true;
  return travelType === "team" && teamGenders.some(isFemaleGender);
}

export function eligibleModes(policy: Policy, ctx: EligibilityContext): ModeOption[] {
  const band = bandPolicy(policy, ctx.band);
  const spec = (mode: string) => policy.modes.find((m) => m.mode === mode);
  const label = (mode: string) => spec(mode)?.label || mode;
  const out: ModeOption[] = [];
  const push = (mode: string, enabled: boolean, reason = "") => {
    const s = spec(mode);
    if (!s) return;
    out.push({ mode, label: label(mode), enabled, reason, requiresReceipt: s.requiresReceipt });
  };

  if (ctx.scope === "inside") {
    // An exception opens the same doors a female traveller has: the band list
    // stops narrowing the options, and the reason goes to the approver.
    const female = femaleTravelling(ctx.gender, ctx.travelType, ctx.teamGenders) || !!ctx.exceptionClaimed;
    const allowed = (isFemaleGender(ctx.gender) ? band?.modesFemale : band?.modesMale) ?? [];
    const teamMin = cfgNum(policy, "TEAM_CAR_MIN_MEMBERS", 3);

    for (const mode of ["Rickshaw", "Bike", "CNG", "Car"]) {
      // A woman travelling may take any of these whatever her band says, and
      // whatever the team is short of.
      const inBand = female || allowed.includes(mode);
      if (mode === "Car") {
        // Car is the only option with conditions layered on top of the band list.
        if (female) {
          push("Car", true);
        } else if (ctx.travelType === "team") {
          if (ctx.teamSize >= teamMin) push("Car", true);
          else push("Car", false, `Car needs at least ${teamMin} travellers — currently ${ctx.teamSize}.`);
        } else if (inBand) {
          push("Car", true);
        } else if (ctx.carSpecialApproval) {
          push("Car", true, "");
        } else {
          push("Car", false, "Your band needs pre-approval for Car. Tick “Car pre-approved” to claim it.");
        }
        continue;
      }
      // A bike carries one person, so it is never a team option — no matter
      // how large the team is.
      if (ctx.travelType === "team" && mode === "Bike") {
        push("Bike", false, "Bike is not available for team travel.");
        continue;
      }
      // A rickshaw seats two. Three travellers cannot share one, whatever the
      // band list says.
      if (mode === "Rickshaw" && ctx.teamSize > 2) {
        push("Rickshaw", false, `Rickshaw seats two — there are ${ctx.teamSize} of you.`);
        continue;
      }
      if (inBand) push(mode, true);
    }

    push("CompanyVehicle", true);
    push("PersonalVehicle", true);
    push("RideSharing", true);
    return out;
  }

  // Outside city.
  for (const s of policy.modes) {
    if (s.scope === "Inside") continue;
    if (s.mode === "Flight") {
      if (band?.flightEligible) push("Flight", true);
      else push("Flight", false, `Flight is not available for Band ${ctx.band}.`);
      continue;
    }
    if (s.mode === "RentACar") {
      if (band?.carPoolEligible || femaleTravelling(ctx.gender, ctx.travelType, ctx.teamGenders) || ctx.exceptionClaimed) {
        push("RentACar", true);
      }
      else push("RentACar", false, `Rent-a-car pooling is not available for Band ${ctx.band}.`);
      continue;
    }
    push(s.mode, true);
  }
  return out;
}

// ── the calculation ─────────────────────────────────────────────────────────


/**
 * Turns a draft plus the employee's profile into every amount, note, warning
 * and blocking error. Callers show `errors` as hard blocks (submit disabled)
 * and `warnings` as things an approver will have to look at.
 */
export function computeRequest(policy: Policy, draft: RequestDraft, user: SessionUser): Computation {
  const notes: string[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  const band = bandPolicy(policy, user.band);
  if (!band) errors.push(`No policy is configured for Band "${user.band}". Contact Administration.`);

  const span = daySpan(draft.fromDate, draft.toDate || draft.fromDate);
  const tripDays = span.total;
  const hours = workingHours(draft.startTime, draft.endTime);

  const teamSize = draft.travelType === "team" ? draft.teamMembers.length + 1 : 1;

  // ── Transportation ────────────────────────────────────────────────────────
  let taAmount = 0;
  let fuelRate = 0;
  const legTotal = draft.legs.reduce((sum, l) => sum + (Number(l.amount) || 0), 0);

  if (draft.scope === "inside") {
    {
      if (draft.transportMode === "CompanyVehicle") {
        taAmount = 0;
        notes.push("Company vehicle used — no transport reimbursement is payable.");
      } else if (draft.transportMode === "PersonalVehicle") {
        fuelRate = fuelRateFor(policy, draft.vehicleType);
        taAmount = money((Number(draft.totalKM) || 0) * fuelRate);
        notes.push(
          `Personal ${draft.vehicleType || "vehicle"}: ${draft.totalKM || 0} km × ${fuelRate} ${cfgStr(policy, "CURRENCY", "BDT")}/km = ${money(taAmount)}.`,
        );
      } else {
        taAmount = money(legTotal);
        if (draft.transportMode) notes.push("Inside-city transport is reimbursed against actual receipts.");
      }
    }
  } else {
    // Outside city: intercity fares are reimbursed at actual against receipts.
    taAmount = money(legTotal);
    if (legTotal > 0) notes.push("Intercity travel is reimbursed at actual against tickets/receipts.");
  }

  // ── Per-Diem and lunch ────────────────────────────────────────────────────
  let perDiemEligible = false;
  let perDiemDays = 0;
  let perDiemAmount = 0;
  let lunchEligible = false;
  let lunchAllowance = 0;

  // A dual-workstation day always counts as a company-meal day.
  const officeMeal = draft.dualWorkstation ? true : draft.officeMealTaken;

  if (draft.scope === "outside") {
    const taken = policy.routes.find((r) => r.value === draft.route);
    if (taken) {
      notes.push(
        `Outside-city travel ${taken.from} to ${draft.city || taken.to} — per-diem, accommodation and intercity fare rules apply instead of the inside-city ones.`,
      );
    }
    perDiemEligible = tripDays > 0;
    perDiemDays = tripDays;
    const perHead = money(span.weekday * (band?.outsideTAWeekday ?? 0) + span.weekend * (band?.outsideTAWeekend ?? 0));
    perDiemAmount = money(perHead * teamSize);
    if (perDiemEligible) {
      notes.push(
        `Outside-city Per-Diem for Band ${user.band}: ${span.weekday} weekday × ${band?.outsideTAWeekday ?? 0} + ${span.weekend} weekend × ${band?.outsideTAWeekend ?? 0} = ${perHead} each` +
        (teamSize > 1 ? `, × ${teamSize} travellers = ${perDiemAmount}` : "") +
        ". This already covers local transport and 3 meals.",
      );
    }
  } else {
    const minHours = cfgNum(policy, "PER_DIEM_MIN_HOURS", 5);
    if (hours >= minHours) {
      perDiemEligible = true;
      perDiemDays = 1;
      const perHead = cfgNum(policy, "PER_DIEM_AMOUNT", 250);
      perDiemAmount = money(perHead * teamSize);
      notes.push(
        `Worked ${hours} hours (≥ ${minHours}) — Per-Diem ${perHead} each` +
        (teamSize > 1 ? ` × ${teamSize} travellers = ${perDiemAmount}` : "") +
        " approved automatically. Lunch is included, so lunch allowance is not payable.",
      );
    } else if (draft.workedDuringLunch) {
      if (officeMeal) {
        notes.push("Office meal was provided — lunch allowance is not payable (no duplicate meal claim).");
      } else {
        lunchEligible = true;
        const perHead = cfgNum(policy, "LUNCH_ALLOWANCE", 150);
        lunchAllowance = money(perHead * teamSize);
        notes.push(
          `Worked ${hours} hours (< ${minHours}) through the lunch window — lunch allowance ${perHead} each` +
          (teamSize > 1 ? ` × ${teamSize} travellers = ${lunchAllowance}` : "") + ".",
        );
      }
    } else if (hours > 0) {
      notes.push(`Worked ${hours} hours (< ${minHours}) and not through lunch — no Per-Diem or lunch allowance.`);
    }
  }

  if (draft.dualWorkstation) {
    notes.push(`Dual workstation (${draft.dualWorkstationType || "unspecified"}) — TA and Per-Diem are allowed, company meal is assumed, duplicate meal claims are blocked.`);
    if (!draft.dualWorkstationType) errors.push("Select a dual-workstation reason.");
  }

  // ── Accommodation ─────────────────────────────────────────────────────────
  const nights = draft.checkIn && draft.checkOut
    ? Math.max(1, Math.round((new Date(`${draft.checkOut}T00:00:00`).getTime() - new Date(`${draft.checkIn}T00:00:00`).getTime()) / 86_400_000))
    : 0;
  const perNightLimit = band?.accommodationLimit ?? 0;
  const accommodationLimit = money(perNightLimit * (nights || 1));
  let accommodationAmount = money(Number(draft.accommodationAmount) || 0);

  if (accommodationAmount > 0) {
    if (draft.scope !== "outside") {
      errors.push("Accommodation can only be claimed for outside-city travel.");
      accommodationAmount = 0;
    } else {
      if (!draft.hotelName) errors.push("Hotel name is required for an accommodation claim.");
      if (!draft.checkIn || !draft.checkOut) errors.push("Check-in and check-out dates are required for an accommodation claim.");
      if (accommodationAmount > accommodationLimit && accommodationLimit > 0) {
        errors.push(
          `Accommodation ${accommodationAmount} exceeds the Band ${user.band} limit of ${perNightLimit}/night × ${nights || 1} night(s) = ${accommodationLimit}.`,
        );
      } else if (accommodationLimit > 0) {
        notes.push(`Accommodation within the Band ${user.band} limit (${perNightLimit}/night × ${nights || 1} = ${accommodationLimit}).`);
      }
    }
  }

  // ── Rent-a-car / car pool ─────────────────────────────────────────────────
  let rentACarAmount = money(Number(draft.rentACarAmount) || 0);
  if (rentACarAmount > 0) {
    const minHead = cfgNum(policy, "RENT_A_CAR_MIN_HEADCOUNT", 3);
    const limit = cfgNum(policy, "RENT_A_CAR_LIMIT", 6000);
    const head = Number(draft.rentACarHeadcount) || 0;
    const femaleParty = femaleTravelling(user.gender, draft.travelType, draft.teamMembers.map((m) => m.gender));
    if (!band?.carPoolEligible && !femaleParty) {
      errors.push(`Rent-a-car pooling is not available for Band ${user.band}.`);
      rentACarAmount = 0;
    } else if (head < minHead) {
      errors.push(`Rent-a-car needs at least ${minHead} employees — ${head} entered. Request rejected by policy.`);
      rentACarAmount = 0;
    } else if (rentACarAmount > limit) {
      warnings.push(`Rent-a-car ${rentACarAmount} exceeds the ${limit} one-way limit — this needs special approval.`);
    } else {
      notes.push(`Rent-a-car pooled across ${head} employees, within the ${limit} one-way limit.`);
    }
  }

  // ── Flight ────────────────────────────────────────────────────────────────
  let flightAmount = money(Number(draft.flightAmount) || 0);
  if (flightAmount > 0 && !band?.flightEligible) {
    errors.push(`Flight is not available for Band ${user.band}.`);
    flightAmount = 0;
  }

  const otherAmount = money(Number(draft.otherAmount) || 0);
  if (otherAmount > 0 && !draft.otherNote) warnings.push("Explain the “other” amount so Finance can verify it.");

  // ── Totals ────────────────────────────────────────────────────────────────
  const totalClaim = money(taAmount + perDiemAmount + lunchAllowance + accommodationAmount + rentACarAmount + flightAmount + otherAmount);

  // ── Advance ───────────────────────────────────────────────────────────────
  const advanceMinDays = cfgNum(policy, "ADVANCE_MIN_TRIP_DAYS", 3);
  // Same notice period as Company Arrangement — applying the morning of
  // travel gives nobody time to actually pay an advance out.
  const noticeDays = cfgNum(policy, "COMPANY_ARRANGE_NOTICE_DAYS", 2);
  const noticeGiven = draft.fromDate ? businessDaysUntil(draft.fromDate) : 0;
  const advanceNoticeOK = noticeGiven >= noticeDays;
  const companyArrangementOK = advanceNoticeOK;
  // Three days qualifies — the threshold is the shortest trip that earns one,
  // not the one it has to beat.
  const advanceAvailable = draft.scope === "outside" && tripDays >= advanceMinDays && advanceNoticeOK;
  let advanceRequested = money(Number(draft.advanceRequested) || 0);
  if (advanceRequested > 0 && !advanceAvailable) {
    errors.push(
      !advanceNoticeOK
        ? `An advance needs at least ${noticeDays} business days' notice before travel — this trip starts too soon. Contact Administration if it cannot wait.`
        : `An advance is only available for outside-city trips of ${advanceMinDays} days or more.`,
    );
    advanceRequested = 0;
  }
  // Declining is a real answer, and worth confirming what it means.
  if (advanceAvailable && !draft.advanceWanted) {
    advanceRequested = 0;
    notes.push(
      `This ${tripDays}-day trip qualifies for a travel advance and you have chosen not to take one — the whole claim is reimbursed after the trip instead.`,
    );
  }
  const deptHeadLimit = cfgNum(policy, "ADVANCE_AUTO_LIMIT", 10000);
  const requiresDeptHeadApproval = advanceRequested > deptHeadLimit;
  if (advanceRequested > 0) {
    notes.push(
      requiresDeptHeadApproval
        ? `Advance ${advanceRequested} is above ${deptHeadLimit} — Line Manager, HR and Department Head approval required.`
        : `Advance ${advanceRequested} — Line Manager and HR approval required.`,
    );
    notes.push(`Settlement is due within ${cfgNum(policy, "ADVANCE_SETTLEMENT_DAYS", 3)} working days of the trip ending.`);
  }

  const finalPayable = money(totalClaim - advanceRequested);

  // The claim type is a result, not a question: whatever the policy actually
  // paid out is what this claim is. Nobody is asked to pick it any more.
  const paidTA = taAmount > 0;
  const paidPerDiem = perDiemAmount > 0 || lunchAllowance > 0;
  const claimType: ClaimType = paidTA && paidPerDiem ? "both" : paidPerDiem ? "perdiem" : "ta";
  if (draft.scope === "inside" && (paidTA || paidPerDiem)) {
    notes.push(
      `Claim resolved automatically as ${
        { ta: "TA only", perdiem: "Per-Diem only", both: "TA + Per-Diem" }[claimType]
      } — from the hours and transport entered, not from a choice.`,
    );
  }

  // ── Cross-field validation ────────────────────────────────────────────────
  if (!draft.fromDate) errors.push("Travel date is required.");

  // A claim has to be filed while the trip is still fresh — counted from the
  // day travel ended, so a five-day trip gets its window after the return.
  const windowDays = cfgNum(policy, "CLAIM_WINDOW_DAYS", 7);
  const endedOn = draft.scope === "outside" ? draft.toDate || draft.fromDate : draft.fromDate;
  const daysSince = endedOn ? daysBetween(endedOn, todayISO()) : 0;
  if (windowDays > 0 && daysSince > windowDays) {
    const unlockedUntil = user.claimUnlockUntil || "";
    // An administrator can open the window for someone who has a reason.
    if (unlockedUntil && todayISO() <= unlockedUntil) {
      notes.push(
        `Filed ${daysSince} days after travel, past the ${windowDays}-day window — allowed because Administration unlocked late claims for you until ${unlockedUntil}.`,
      );
    } else {
      errors.push(
        `You cannot claim for this travel: it ended ${daysSince} days ago and claims must be filed within ${windowDays} days. Contact Administration to unlock it.`,
      );
    }
  }
  if (!draft.purpose) errors.push("Purpose is required.");
  if (draft.scope === "inside") {
    // Inside-city trips pick the destination from a list; what that choice
    // asks for next decides what still has to be filled in.
    const chosen = policy.destinationTypes.find(
      (d) => d.value === draft.destinationType && (!d.cities.length || d.cities.includes(draft.city)),
    );
    if (!chosen) errors.push("Select a destination.");
    else if (chosen.needs === "name" && !draft.destination) {
      errors.push(`${chosen.label} name is required.`);
    }
    if (cityZone(policy, draft.city) === "Outside") errors.push(`${draft.city} is not an inside-city location.`);
    if (!draft.startTime || !draft.endTime) errors.push("Start and end time are required to calculate Per-Diem.");
    // Hours at one of our own offices are checked against the attendance
    // record, so the punches are what make the claim provable. Keyed off the
    // destination rather than a separate "worked at" question, which asked the
    // same thing twice.
    if (chosen?.needs === "office") {
      warnings.push(
        `Visiting the ${chosen.label} — you must punch the card both in and out. Without both punches this claim will be rejected.`,
      );
    }
    if (!draft.transportMode) errors.push("Select a mode of transport.");
    if (draft.transportMode === "PersonalVehicle") {
      if (!draft.vehicleType) errors.push("Select the personal vehicle type.");
      if (!(Number(draft.totalKM) > 0)) errors.push("Total KM is required for a personal vehicle claim.");
      if (!draft.travelFrom || !draft.travelTo) errors.push("Travel from and to are required for a personal vehicle claim.");
    }
    if (draft.transportMode === "RideSharing" && legTotal <= 0) {
      errors.push("Add at least one ride-sharing trip with its amount and receipt.");
    }
  } else {
    if (!draft.toDate) errors.push("Return date is required for outside-city travel.");
    if (tripDays <= 0) errors.push("The return date cannot be before the travel date.");
    // Outside-city travel is described by a route, not by a district: Dhaka to
    // Chattogram is outside-city even though Chattogram is an inside-city
    // location in its own right, so the city's zone cannot decide this.
    const taken = policy.routes.find((r) => r.value === draft.route);
    if (!taken) errors.push("Select a route.");
    else if (!draft.city) errors.push(`Which city did you travel to from ${taken.from}?`);
    else if (taken.to && draft.city !== taken.to) errors.push(`${taken.label} must end in ${taken.to}.`);
    if (draft.arrangement === "company") {
      if (!companyArrangementOK) {
        errors.push(
          `Company-arranged travel requires at least ${noticeDays} business days' notice. Please choose Self Arrangement or contact Administration.`,
        );
      } else {
        notes.push(`Company arrangement requested with ${noticeGiven} business days' notice — Administration will be notified automatically.`);
      }
    }
  }

  if (draft.travelType === "team") {
    if (draft.teamMembers.length < 1) errors.push("Add at least one team member, or switch back to Individual travel.");
    else notes.push(`Team travel with ${teamSize} travellers.`);
  }

  // ── Where the money goes ──────────────────────────────────────────────────
  // Bank payout is off until an administrator turns it on, so a draft asking
  // for one is refused rather than quietly paid to a number instead.
  const bankAllowed = bankPayoutAllowed(policy);
  const payoutMethod = draft.payoutMethod === "bank" && bankAllowed ? "bank" : "bkash";
  if (draft.payoutMethod === "bank" && !bankAllowed) {
    errors.push("Bank payment is not switched on. Claims are paid by bKash.");
  }
  if (finalPayable > 0) {
    if (payoutMethod === "bank") {
      const bankFields: [string, string][] = [
        ["Bank name", draft.bankName],
        ["Account name", draft.bankAccountName],
        ["Account number", draft.bankAccountNumber],
        ["Routing number", draft.bankRoutingNumber],
        ["Branch", draft.bankBranch],
      ];
      for (const [label, value] of bankFields) {
        if (!String(value || "").trim()) errors.push(`${label} is required for a bank payment.`);
      }
    } else {
      const bkashOK = (label: string, v: string) => {
        const bkash = String(v || "").replace(/[\s-]/g, "");
        if (!bkash) errors.push(`Enter the bKash number ${label} should be paid to.`);
        else if (!/^01[3-9]\d{8}$/.test(bkash)) {
          errors.push(`${label}'s bKash number does not look right — it should be 11 digits starting 01, e.g. 01712345678.`);
        }
      };
      // Team travel is paid out separately, one number per traveller — the
      // claimant's own share plus everyone else's.
      bkashOK("you", draft.bkashNumber);
      if (draft.travelType === "team") {
        draft.teamMembers.forEach((m) => bkashOK(m.name || "your teammate", m.bkashNumber));
      }
    }
  }

  // ── Document links ────────────────────────────────────────────────────────
  const links = draft.documentLinks.filter(Boolean);
  const malformed = links.filter((l) => !/^https?:\/\/\S+$/i.test(l));
  if (malformed.length) {
    errors.push(`These are not valid links: ${malformed.slice(0, 3).join(", ")}. Paste the full URL starting with https://`);
  }
  if (links.length && !draft.documentTypes.length) {
    errors.push("Select which document type(s) your links cover.");
  }
  // A rickshaw fare or a personal-vehicle claim has nothing to attach — there
  // is no receipt for either. Only ask for one when something actually issues
  // one: the chosen transport mode, or a cost that always comes with a bill.
  const modeSpec = policy.modes.find((m) => m.mode === draft.transportMode);
  const needsReceipt = !!modeSpec?.requiresReceipt
    || accommodationAmount > 0 || rentACarAmount > 0 || flightAmount > 0 || otherAmount > 0;
  if (cfgStr(policy, "REQUIRE_DOCUMENT_LINK", "Yes").toLowerCase() === "yes" && needsReceipt && !links.length) {
    errors.push("Share at least one document link (Drive, bill, ticket or receipt) supporting this claim.");
  }
  if (links.some((l) => /drive\.google\.com|docs\.google\.com/i.test(l))) {
    notes.push(`${links.length} document link(s) attached — approvers open them directly, so keep the Drive sharing open to them.`);
  }

  if (draft.exceptionClaimed) {
    if (!draft.exceptionReason.trim()) {
      errors.push("Explain why this exception was necessary.");
    } else {
      warnings.push(
        `Policy exception claimed — an approver must accept it before this is paid. Reason: ${draft.exceptionReason.trim()}`,
      );
    }
  }

  // The chosen mode must still be legal for this employee.
  if (draft.transportMode) {
    const opts = eligibleModes(policy, {
      band: user.band,
      gender: user.gender,
      scope: draft.scope,
      travelType: draft.travelType,
      teamSize,
      teamGenders: draft.teamMembers.map((m) => m.gender),
      exceptionClaimed: draft.exceptionClaimed,
      carSpecialApproval: draft.carSpecialApproval,
    });
    const chosen = opts.find((o) => o.mode === draft.transportMode);
    if (!chosen) errors.push(`${draft.transportMode} is not available for Band ${user.band}.`);
    else if (!chosen.enabled) errors.push(chosen.reason);
  }

  return {
    workingHours: hours,
    tripDays,
    weekdayDays: span.weekday,
    weekendDays: span.weekend,
    claimType,
    taAmount: money(taAmount),
    perDiemEligible,
    perDiemDays,
    perDiemAmount: money(perDiemAmount),
    lunchEligible,
    lunchAllowance: money(lunchAllowance),
    accommodationAmount,
    accommodationLimit,
    rentACarAmount,
    flightAmount,
    otherAmount,
    totalClaim,
    advanceRequested,
    finalPayable,
    advanceAvailable,
    noticeOK: advanceNoticeOK,
    noticeGiven,
    noticeDaysRequired: noticeDays,
    requiresDeptHeadApproval,
    notes,
    errors,
    warnings,
  };
}

/**
 * The trips a claim implies, worked out from what has already been entered.
 *
 * Nobody should have to retype a journey the form already knows about: the
 * dates come from the trip, and the ends from the city, route and destination.
 * Only the fare is genuinely new information, so that is all this leaves to
 * fill in. Extra hops can still be added by hand on top of these.
 */
export function impliedLegs(policy: Policy, draft: RequestDraft): Leg[] {
  const mode = draft.transportMode;
  // These two are not reimbursed per journey — one is free, the other by the
  // kilometre — so neither has fares to enter.
  if (!mode || mode === "CompanyVehicle" || mode === "PersonalVehicle") return [];

  const leg = (travelDate: string, travelFrom: string, travelTo: string): Leg =>
    ({ travelDate, mode, travelFrom, travelTo, amount: 0, note: "" });

  if (draft.scope === "inside") {
    const kind = policy.destinationTypes.find((d) => d.value === draft.destinationType);
    // An "Other Office" destination keeps which office in the purpose, so name
    // it here — "Other Office" on its own says nothing about where you went.
    const named = kind?.needs === "office"
      ? [kind.label, draft.purpose].filter(Boolean).join(" — ")
      : kind?.label || "";
    return [leg(draft.fromDate, draft.city, draft.destination || named)];
  }

  const route = policy.routes.find((r) => r.value === draft.route);
  const from = route?.from || "";
  const to = draft.city || route?.to || "";
  const out = [leg(draft.fromDate, from, to)];
  // Outside-city travel is there and back, so the return is a second ticket
  // priced separately — including a same-day return. It waits for a return
  // date rather than guessing one.
  if (draft.toDate) out.push(leg(draft.toDate, to, from));
  return out;
}

/** Fresh draft with every field defined, so React inputs stay controlled. */
export function emptyDraft(scope: Scope = "inside"): RequestDraft & { carSpecialApproval: boolean } {
  const today = new Date().toISOString().slice(0, 10);
  return {
    scope,
    city: scope === "inside" ? "Dhaka" : "",
    claimType: "both",
    travelType: "individual",
    teamMembers: [],
    fromDate: today,
    // Outside-city travel has no sensible default return date. Defaulting it to
    // today invented a return leg dated before the outbound one, or dated the
    // same day when the trip started today.
    toDate: scope === "outside" ? "" : today,
    purpose: "",
    destinationType: "",
    route: "",
    exceptionClaimed: false,
    exceptionReason: "",
    advanceWanted: false,
    payoutMethod: "bkash",
    bankName: "",
    bankAccountName: "",
    bankAccountNumber: "",
    bankRoutingNumber: "",
    bankBranch: "",
    destination: "",
    startTime: "",
    endTime: "",
    workedAt: "",
    arrangement: "self",
    transportMode: "",
    vehicleType: "",
    travelFrom: "",
    travelTo: "",
    totalKM: 0,
    legs: [],
    workedDuringLunch: false,
    officeMealTaken: false,
    dualWorkstation: false,
    dualWorkstationType: "",
    hotelName: "",
    checkIn: "",
    checkOut: "",
    accommodationAmount: 0,
    rentACarAmount: 0,
    rentACarHeadcount: 0,
    flightAmount: 0,
    otherAmount: 0,
    otherNote: "",
    advanceRequested: 0,
    bkashNumber: "",
    documentTypes: [],
    documentLinks: [],
    employeeNote: "",
    carSpecialApproval: false,
  };
}
