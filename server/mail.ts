/**
 * Claim notifications, sent through the 10MS Postal service.
 *
 * Who hears about what:
 *   submitted          → every traveller's supervisor (the submitter's own one is asked to act),
 *                        and the travellers themselves
 *   supervisor approved → HR (to act) and the travellers
 *   HR approved        → Finance (to act), the travellers and their supervisors
 *   Finance approved   → HR, the travellers and their supervisors
 *   rejected / returned → the travellers
 *
 * "Travellers" are the submitter plus every team member on the claim. Each
 * address gets exactly one mail per event: a supervisor with two people on the
 * same trip gets one mail naming both, not two.
 *
 * Mail never blocks a claim: a failure is logged and the request goes on.
 */
import type { RequestRecord } from "../shared/types.js";
import { readTab } from "./db.js";
import { toRoleGrant } from "./store.js";

const MAIL_URL = process.env.POSTAL_MAIL_URL || "https://stage-postal.10minuteschool.net/api/v1/mail/send";
const MAIL_TIMEOUT_MS = 8000;

export type ClaimEvent =
  | { kind: "submitted"; resubmit: boolean }
  | { kind: "approved"; stage: string; by: string; remarks: string }
  | { kind: "rejected" | "returned"; stage: string; by: string; remarks: string };

const STAGE_NAME: Record<string, string> = {
  manager_review: "Supervisor",
  admin_review: "HR",
  finance_review: "Finance",
};

interface Recipient {
  name: string;
  /** This person is travelling on the claim. */
  traveller: boolean;
  /** This person raised the claim. */
  submitter: boolean;
  /** Travellers on this claim who report to this person. */
  reports: string[];
  /** The decision is now at this person's desk. */
  act: boolean;
  /** Notified as HR or Finance. */
  desk: "" | "HR" | "Finance";
}

const clean = (e: string | undefined) => String(e || "").trim().toLowerCase();

async function roleEmails(role: "hr" | "finance"): Promise<string[]> {
  const fromEnv = String(process.env[role === "hr" ? "HR_EMAILS" : "FINANCE_EMAILS"] || "")
    .split(",").map(clean).filter(Boolean);
  let granted: string[] = [];
  try {
    granted = (await readTab("RoleGrants")).map(toRoleGrant).filter((g) => g.role === role).map((g) => g.email);
  } catch (err) {
    console.warn("[mail] could not read RoleGrants:", (err as Error).message);
  }
  return [...new Set([...fromEnv, ...granted].map(clean).filter(Boolean))];
}

function travellersOf(record: RequestRecord) {
  return [
    { name: record.employeeName, email: clean(record.email), supervisorEmail: clean(record.managerEmail) },
    ...record.teamMembers.map((m) => ({ name: m.name, email: clean(m.email), supervisorEmail: clean(m.supervisorEmail) })),
  ];
}

/** Works out one entry per address for this event. */
async function recipientsFor(record: RequestRecord, event: ClaimEvent): Promise<Map<string, Recipient>> {
  const out = new Map<string, Recipient>();
  const get = (email: string) => {
    let r = out.get(email);
    if (!r) out.set(email, (r = { name: "", traveller: false, submitter: false, reports: [], act: false, desk: "" }));
    return r;
  };
  const travellers = travellersOf(record);

  const addTravellers = () => {
    for (const t of travellers) {
      if (!t.email) continue;
      const r = get(t.email);
      r.traveller = true;
      r.name = t.name;
    }
    const me = clean(record.email);
    if (me) get(me).submitter = true;
  };
  const addSupervisors = () => {
    for (const t of travellers) {
      if (!t.supervisorEmail) continue;
      const r = get(t.supervisorEmail);
      if (!r.reports.includes(t.name)) r.reports.push(t.name);
    }
  };
  const addDesk = async (role: "hr" | "finance", act: boolean) => {
    for (const email of await roleEmails(role)) {
      const r = get(email);
      r.desk = role === "hr" ? "HR" : "Finance";
      r.act = r.act || act;
    }
  };

  if (event.kind === "submitted") {
    addTravellers();
    addSupervisors();
    const approver = clean(record.managerEmail);
    if (approver) get(approver).act = true;
  } else if (event.kind === "approved") {
    addTravellers();
    if (event.stage === "manager_review") {
      await addDesk("hr", true);
    } else if (event.stage === "admin_review") {
      addSupervisors();
      await addDesk("finance", true);
    } else if (event.stage === "finance_review") {
      addSupervisors();
      await addDesk("hr", false);
    }
  } else {
    addTravellers();
  }
  return out;
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

function headline(record: RequestRecord, event: ClaimEvent): string {
  const id = record.requestId;
  if (event.kind === "submitted") return `${id} ${event.resubmit ? "resubmitted" : "submitted"} by ${record.employeeName}`;
  const stage = STAGE_NAME[event.stage] || event.stage;
  if (event.kind === "approved") {
    return event.stage === "finance_review" ? `${id} approved by Finance — payment is next` : `${id} approved by ${stage}`;
  }
  return event.kind === "rejected" ? `${id} rejected by ${stage}` : `${id} returned by ${stage}`;
}

function nextStepFor(record: RequestRecord, event: ClaimEvent, r: Recipient): string {
  if (r.act) {
    if (event.kind === "submitted") return "This claim is waiting for your approval as supervisor.";
    return `This claim is waiting for your review as ${r.desk}.`;
  }
  if (event.kind === "rejected") return "The claim has been closed and will not be paid.";
  if (event.kind === "returned") {
    return r.submitter ? "Please correct it and submit it again." : "The submitter needs to correct it and submit it again.";
  }
  if (event.kind === "submitted") return "It is now with the supervisor for approval.";
  if (event.stage === "manager_review") return "It is now with HR for review.";
  if (event.stage === "admin_review") return "It is now with Finance for review.";
  return "Finance has approved it; payment will follow.";
}

function bodyFor(record: RequestRecord, event: ClaimEvent, r: Recipient, link: string): string {
  const lines: string[] = [];
  lines.push(`<p>Hello${r.name ? ` ${esc(r.name)}` : ""},</p>`);
  lines.push(`<p><b>${esc(headline(record, event))}</b></p>`);

  const about: string[] = [];
  if (r.traveller) about.push("you are travelling on this claim");
  if (r.reports.length) about.push(`your team member${r.reports.length > 1 ? "s" : ""} ${esc(r.reports.join(", "))} ${r.reports.length > 1 ? "are" : "is"} on this claim`);
  if (about.length) lines.push(`<p>You are getting this because ${about.join(", and ")}.</p>`);

  if (event.kind !== "submitted" && (event.by || event.remarks)) {
    lines.push(`<p>${event.by ? `By: ${esc(event.by)}<br>` : ""}${event.remarks ? `Remark: ${esc(event.remarks)}` : ""}</p>`);
  }

  const travellers = travellersOf(record).map((t) => t.name).filter(Boolean);
  const amount = record.approvedAmount || record.totalClaim;
  const row = (k: string, v: string) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#64748b">${esc(k)}</td><td style="padding:4px 0">${esc(v)}</td></tr>`;
  lines.push(
    `<table style="border-collapse:collapse;font-size:14px">` +
      row("Request", record.requestId) +
      row("Submitted by", `${record.employeeName}${record.employeeId ? ` (${record.employeeId})` : ""}`) +
      (travellers.length > 1 ? row("Travellers", travellers.join(", ")) : "") +
      row("Trip", [record.fromDate, record.toDate].filter(Boolean).join(" to ")) +
      (record.purpose ? row("Purpose", record.purpose) : "") +
      row("Amount", `${amount.toLocaleString("en-US")} BDT`) +
      `</table>`,
  );

  const next = nextStepFor(record, event, r);
  if (next) lines.push(`<p>${esc(next)}</p>`);
  if (link) lines.push(`<p><a href="${esc(link)}">Open the TA/DA system</a></p>`);
  lines.push(`<p style="color:#94a3b8;font-size:12px">This is an automatic message from the TA/DA system.</p>`);
  return `<div style="font-family:Arial,sans-serif;color:#0f172a">${lines.join("\n")}</div>`;
}

async function send(to: string, subject: string, body: string, token: string): Promise<void> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), MAIL_TIMEOUT_MS);
  try {
    const res = await fetch(MAIL_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "mail", to: [to], cc: [], bcc: [], subject, body, html: true }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sends this event's mails. Never throws; failures are logged per address.
 * `link` is where the app is reachable, for the "open" link in the mail.
 * `token` is the acting person's own 10MS sign-in token, sent as the Bearer
 * value — the same token the browser uses for document uploads.
 */
export async function notifyClaim(record: RequestRecord, event: ClaimEvent, link: string, token: string): Promise<void> {
  try {
    if (!token) {
      console.warn(`[mail] ${record.requestId}: no 10MS sign-in token came with the request; mails not sent.`);
      return;
    }
    const recipients = await recipientsFor(record, event);
    const subject = `[TA/DA] ${headline(record, event)}`;
    const results = await Promise.allSettled(
      [...recipients].map(([email, r]) => send(email, subject, bodyFor(record, event, r, link), token)),
    );
    results.forEach((res, i) => {
      if (res.status === "rejected") {
        console.warn(`[mail] ${record.requestId} → ${[...recipients.keys()][i]} failed:`, (res.reason as Error)?.message);
      }
    });
  } catch (err) {
    console.warn(`[mail] ${record.requestId} notifications failed:`, (err as Error).message);
  }
}
