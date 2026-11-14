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
 *   paid               → the travellers (asked to confirm the money arrived) and their supervisors
 *
 * "Travellers" are the submitter plus every team member on the claim. Each
 * address gets exactly one mail per event: a supervisor with two people on the
 * same trip gets one mail naming both, not two.
 *
 * Mail never blocks a claim: a failure is logged and the request goes on.
 */
import type { MailBatch, RequestRecord, UnlockRequest } from "../shared/types.js";
import { GROUP_FOR_ROLE, listDirectoryMembers, type DirectoryMember } from "./tenms.js";

const MAIL_URL = process.env.POSTAL_MAIL_URL || "https://postal.10minuteschool.com/api/v1/mail/send";

/** The address the claim mails come from. */
const MAIL_FROM = process.env.POSTAL_MAIL_FROM || "peopleops@10minuteschool.com";

export type ClaimEvent =
  | { kind: "submitted"; resubmit: boolean }
  | { kind: "approved"; stage: string; by: string; remarks: string }
  | { kind: "rejected" | "returned"; stage: string; by: string; remarks: string }
  | { kind: "paid"; amount: number; mode: string; transactionId: string; date: string; repaid: boolean };

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

type DeskRole = "hr" | "admin" | "finance";

/**
 * Who to email at each desk: everyone in the desk's 10MS group (ta_da_admin / ta_da_hr /
 * ta_da_finance), found by reading the 10MS directory with the signed-in person's token. The
 * answer is kept for a few minutes. ADMIN_EMAILS / HR_EMAILS / FINANCE_EMAILS (comma-separated)
 * add to that, and stand in if the directory cannot be read.
 */
let directoryCache: { at: number; members: DirectoryMember[] } | null = null;
const DIRECTORY_TTL_MS = 10 * 60_000;

async function roleEmails(role: DeskRole, token: string): Promise<string[]> {
  const envName = role === "admin" ? "ADMIN_EMAILS" : role === "hr" ? "HR_EMAILS" : "FINANCE_EMAILS";
  const fromEnv = String(process.env[envName] || "").split(",").map(clean).filter(Boolean);
  let fromGroup: string[] = [];
  if (token) {
    try {
      if (!directoryCache || Date.now() - directoryCache.at > DIRECTORY_TTL_MS) {
        directoryCache = { at: Date.now(), members: await listDirectoryMembers(token) };
        if (directoryCache.members.length && directoryCache.members.every((m) => !m.groups.length)) {
          console.warn("[mail] the 10MS directory returned people without groups, so desk emails come from the settings only.");
        }
      }
      const group = GROUP_FOR_ROLE.find(([r]) => r === role)?.[1];
      fromGroup = directoryCache.members.filter((m) => group && m.groups.includes(group)).map((m) => m.email);
    } catch (err) {
      console.warn(`[mail] could not read the ${role} group from the directory:`, (err as Error).message);
    }
  }
  return [...new Set([...fromGroup, ...fromEnv].map(clean).filter(Boolean))];
}

/**
 * A claim's mail goes to its own owner and that owner's own supervisor. On a team trip every
 * traveller has their own claim (see childFromMain), so each one is mailed about theirs, to
 * their own supervisor — not all together on the submitter's claim.
 */
function travellersOf(record: RequestRecord) {
  return [{ name: record.employeeName, email: clean(record.email), supervisorEmail: clean(record.managerEmail) }];
}

/** Works out one entry per address for this event. */
async function recipientsFor(record: RequestRecord, event: ClaimEvent, token: string): Promise<Map<string, Recipient>> {
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
  /** `acts`: the roles whose members have to act now; the rest are only informed. */
  const addDesk = async (roles: DeskRole[], desk: "HR" | "Finance", acts: DeskRole[]) => {
    for (const role of roles) {
      for (const email of await roleEmails(role, token)) {
        const r = get(email);
        r.desk = desk;
        r.act = r.act || acts.includes(role);
      }
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
      // HR's desk is acted on by admins; HR-role holders are kept informed.
      await addDesk(["admin", "hr"], "HR", ["admin"]);
    } else if (event.stage === "admin_review") {
      addSupervisors();
      await addDesk(["finance"], "Finance", ["finance"]);
    } else if (event.stage === "finance_review") {
      addSupervisors();
      await addDesk(["admin", "hr"], "HR", []);
    }
  } else if (event.kind === "paid") {
    addTravellers();
    addSupervisors();
  } else {
    addTravellers();
    // A rejection also tells the supervisors, whoever rejected it.
    if (event.kind === "rejected") addSupervisors();
  }
  return out;
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

function headline(record: RequestRecord, event: ClaimEvent): string {
  const id = record.requestId;
  if (event.kind === "submitted") return `${id} ${event.resubmit ? "resubmitted" : "submitted"} by ${record.employeeName}`;
  if (event.kind === "paid") return `${id} ${event.repaid ? "paid again" : "paid"} — please confirm you received it`;
  const stage = STAGE_NAME[event.stage] || event.stage;
  if (event.kind === "approved") {
    return event.stage === "finance_review" ? `${id} approved by Finance — payment is next` : `${id} approved by ${stage}`;
  }
  return event.kind === "rejected" ? `${id} rejected by ${stage}` : `${id} returned by ${stage}`;
}

function nextStepFor(record: RequestRecord, event: ClaimEvent, r: Recipient): string {
  if (event.kind === "paid") {
    return r.traveller
      ? "Please confirm the money reached you. You cannot raise a new claim until this one is answered."
      : `Finance has paid it; ${record.employeeName} now needs to confirm the money arrived.`;
  }
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

  if (event.kind === "paid") {
    lines.push(
      `<p>Paid: <b>${esc(event.amount.toLocaleString("en-US"))} BDT</b>` +
        `${event.mode ? ` by ${esc(event.mode)}` : ""}${event.date ? ` on ${esc(event.date)}` : ""}` +
        `${event.transactionId ? `<br>Transaction ID: ${esc(event.transactionId)}` : ""}</p>`,
    );
  } else if (event.kind !== "submitted" && (event.by || event.remarks)) {
    lines.push(`<p>${event.by ? `By: ${esc(event.by)}<br>` : ""}${event.remarks ? `Remark: ${esc(event.remarks)}` : ""}</p>`);
  }

  const travellers = record.teamMembers.map((m) => m.name).filter(Boolean);
  const amount = record.approvedAmount || record.totalClaim;
  const row = (k: string, v: string) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#64748b">${esc(k)}</td><td style="padding:4px 0">${esc(v)}</td></tr>`;
  lines.push(
    `<table style="border-collapse:collapse;font-size:14px">` +
      row("Request", record.requestId) +
      row(record.linkedTo ? "Claim for" : "Submitted by", `${record.employeeName}${record.employeeId ? ` (${record.employeeId})` : ""}`) +
      (record.linkedTo ? row("Team trip", `Part of ${record.linkedTo}, filed by a teammate. This is your own claim.`) : "") +
      (travellers.length ? row("Team members", travellers.join(", ")) : "") +
      row("Trip", [record.fromDate, record.toDate].filter(Boolean).join(" to ")) +
      (record.purpose ? row("Purpose", record.purpose) : "") +
      row("Amount", `${amount.toLocaleString("en-US")} BDT`) +
      `</table>`,
  );

  const next = nextStepFor(record, event, r);
  if (next) lines.push(`<p>${esc(next)}</p>`);
  if (link && event.kind === "paid" && r.traveller) {
    // "Yes" signs the person in, opens the claim and records the receipt. Nothing happens on
    // the link alone (a mail scanner opening it cannot sign in), so it is safe to put in a mail.
    const base = `${link.replace(/\/$/, "")}/?request=${encodeURIComponent(record.requestId)}`;
    const yes = `${base}&ack=received`;
    lines.push(
      `<p style="margin:20px 0 6px"><a href="${esc(yes)}" style="display:inline-block;background:#15803d;color:#ffffff;` +
        `text-decoration:none;font-weight:600;font-size:14px;padding:11px 20px;border-radius:8px">` +
        `Yes, I received it</a></p>` +
        `<p style="color:#64748b;font-size:12px;margin:0">Didn't get it? <a href="${esc(base)}">Open the claim</a> and choose ` +
        `"No, it never arrived" so Finance can look into it.</p>` +
        `<p style="color:#64748b;font-size:12px;margin:4px 0 0">Button not working? Open ${esc(yes)}</p>`,
    );
  } else if (link) {
    // Straight to this claim; the app asks the person to sign in first if they have to.
    const target = `${link.replace(/\/$/, "")}/?request=${encodeURIComponent(record.requestId)}`;
    lines.push(
      `<p style="margin:20px 0 6px"><a href="${esc(target)}" style="display:inline-block;background:#171717;color:#ffffff;` +
        `text-decoration:none;font-weight:600;font-size:14px;padding:11px 20px;border-radius:8px">` +
        `View claim</a></p>` +
        `<p style="color:#64748b;font-size:12px;margin:0">Button not working? Open ${esc(target)}</p>`,
    );
  }
  lines.push(`<p style="color:#94a3b8;font-size:12px">This is an automatic message from the TA/DA system.</p>`);
  return `<div style="font-family:Arial,sans-serif;color:#0f172a">${lines.join("\n")}</div>`;
}

/**
 * Builds this event's mails. The server does not send them: Postal's Cloudflare
 * check turns away calls that come from a server, so the signed-in person's
 * browser posts them (with their own 10MS token) the way it posts uploads.
 * Never throws; a failure here just means no mails for the event.
 * `link` is where the app is reachable, for the "open" link in the mail.
 */
export async function planClaimMail(record: RequestRecord, event: ClaimEvent, link: string, token = ""): Promise<MailBatch> {
  try {
    const recipients = await recipientsFor(record, event, token);
    if (!recipients.size) console.warn(`[mail] ${record.requestId}: nobody to notify — no email addresses on the claim.`);
    const subject = `[TA/DA] ${headline(record, event)}`;
    return {
      url: MAIL_URL,
      from: MAIL_FROM,
      jobs: [...recipients].map(([to, r]) => ({
        to,
        // Only the person paid is asked to confirm; their supervisor is just told it was paid.
        subject: event.kind === "paid" && !r.traveller ? `[TA/DA] ${record.requestId} paid to ${record.employeeName}` : subject,
        body: bodyFor(record, event, r, link),
      })),
    };
  } catch (err) {
    console.warn(`[mail] ${record.requestId} could not prepare notifications:`, (err as Error).message);
    return { url: MAIL_URL, from: MAIL_FROM, jobs: [] };
  }
}

/**
 * Mails about a "Contact HR" unlock request. A new request goes to everyone at the HR and admin
 * desks (ADMIN_EMAILS / HR_EMAILS) with a link to where they decide it; the decision goes back to
 * the person who asked, with the HR remark and how long the unlock stays open.
 */
export async function planUnlockMail(
  request: UnlockRequest,
  kind: "requested" | "approved" | "rejected",
  link: string,
  token = "",
  unlockDays = 2,
): Promise<MailBatch> {
  const row = (k: string, v: string) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#64748b">${esc(k)}</td><td style="padding:4px 0">${esc(v)}</td></tr>`;
  const button = (path: string, label: string) => {
    if (!link) return "";
    const target = `${link.replace(/\/$/, "")}/${path}`;
    return (
      `<p style="margin:20px 0 6px"><a href="${esc(target)}" style="display:inline-block;background:#171717;color:#ffffff;` +
      `text-decoration:none;font-weight:600;font-size:14px;padding:11px 20px;border-radius:8px">${esc(label)}</a></p>` +
      `<p style="color:#64748b;font-size:12px;margin:0">Button not working? Open ${esc(target)}</p>`
    );
  };
  const frame = (inner: string) =>
    `<div style="font-family:Arial,sans-serif;color:#0f172a">${inner}` +
    `<p style="color:#94a3b8;font-size:12px">This is an automatic message from the TA/DA system.</p></div>`;

  try {
    if (kind === "requested") {
      const to = [...new Set([...(await roleEmails("hr", token)), ...(await roleEmails("admin", token))])];
      const body = frame(
        `<p>Hello,</p><p><b>${esc(request.employeeName)} is asking to unlock an older claim date.</b></p>` +
        `<table style="border-collapse:collapse;font-size:14px">` +
          row("Request", request.requestId) +
          row("Employee", `${request.employeeName} (${request.employeeId})`) +
          (request.department ? row("Department", request.department) : "") +
          (request.requestedFrom ? row("Date to unlock", request.requestedFrom) : "") +
          row("Reason", request.reason) +
        `</table><p>Approve or reject it under Unlocks &amp; Blocks.</p>` +
        button("?view=admin", "Review the request"),
      );
      return { url: MAIL_URL, from: MAIL_FROM, jobs: to.map((email) => ({ to: email, subject: `[TA/DA] Unlock request from ${request.employeeName}`, body })) };
    }

    const to = clean(request.email);
    if (!to) return { url: MAIL_URL, from: MAIL_FROM, jobs: [] };
    const approved = kind === "approved";
    const body = frame(
      `<p>Hello ${esc(request.employeeName)},</p>` +
      `<p><b>Your request to unlock an older claim date was ${approved ? "approved" : "rejected"}.</b></p>` +
      `<table style="border-collapse:collapse;font-size:14px">` +
        row("Request", request.requestId) +
        (approved ? row("Unlocked date", request.unlockFrom) : request.requestedFrom ? row("Date asked for", request.requestedFrom) : "") +
        row("Decided by", request.decidedBy.replace(/<.*>/, "").trim()) +
        row("Remark", request.decisionRemarks) +
      `</table>` +
      (approved
        ? `<p>It stays open for ${unlockDays} day${unlockDays === 1 ? "" : "s"} from now. Please file your claim in that time — after that the claim window goes back to normal.</p>`
        : `<p>You can send a new request from the New Request form if you need to.</p>`) +
      button("", approved ? "File your claim" : "Open the TA/DA system"),
    );
    return { url: MAIL_URL, from: MAIL_FROM, jobs: [{ to, subject: `[TA/DA] Your unlock request was ${approved ? "approved" : "rejected"}`, body }] };
  } catch (err) {
    console.warn(`[mail] unlock request ${request.requestId} could not be prepared:`, (err as Error).message);
    return { url: MAIL_URL, from: MAIL_FROM, jobs: [] };
  }
}
