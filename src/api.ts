/** Typed fetch wrapper. Holds the session token and unwraps API errors. */

import { auth } from "./lib/auth.js";
import type {
  ApprovalRow, Computation, InsideCityBlockEntry, Policy, RoleGrant, RequestDraft, RequestRecord, SessionUser, UnlockRequest,
  VehicleRegistration,
} from "../shared/types.js";
import type { ModeOption } from "../shared/policy.js";

const TOKEN_KEY = "ta-perdiem-token";

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) || "";
}
export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

/**
 * What to do when the server says the session is gone.
 *
 * This used to be `window.location.reload()`, which loops: reloading does not
 * clear the *provider* session, so the app boots, exchanges that session for an
 * app token again, gets the same 401, and reloads again. Embedded in another
 * site the reload is invisible as a reload — it just looks like the page
 * flickering between the spinner and the sign-in screen. Re-rendering into a
 * signed-out state ends the cycle and leaves the reason on screen.
 */
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      ...(init.headers || {}),
    },
  });
  if (res.status === 401) {
    clearToken();
    onUnauthorized?.();
    const text = await res.text().catch(() => "");
    let message = "Your session has expired. Please sign in again.";
    try {
      message = JSON.parse(text).error || message;
    } catch {
      /* a non-JSON 401 (a proxy, say) keeps the default wording */
    }
    throw Object.assign(new Error(message), { status: 401 });
  }
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) throw Object.assign(new Error(body.error || `Request failed (${res.status})`), { body });
  return body as T;
}

const post = <T,>(path: string, data: unknown) =>
  call<T>(path, { method: "POST", body: JSON.stringify(data) });

export interface Summary {
  pending: number;
  approved: number;
  rejected: number;
  returned: number;
  paymentPending: number;
  paid: number;
  totalClaims: number;
  totalPaid: number;
  count: number;
}

/** Counters for the approver workspace — never mixed with personal claims. */
export interface DeskSummary {
  pending: number;
  pendingValue: number;
  processed: number;
  inFlight: number;
  awaitingPayment: number;
  advancesOpen: number;
  totalValue: number;
  count: number;
}

/** The advance step this user may take, decided by the server. */
export interface AdvanceStep {
  action: string;
  label: string;
}

/** A row in a list: the claim plus where it currently sits. */
export interface RequestListItem extends RequestRecord {
  isMine: boolean;
  /** Which desk it is waiting on right now, e.g. "Administration". */
  waitingOn: string;
  lastAction: string;
  lastActionAt: string;
}

export interface LinkedRequest {
  requestId: string;
  employeeName: string;
  bkashNumber: string;
  totalClaim: number;
  finalPayable: number;
  status: string;
}

export interface RequestDetail {
  request: RequestRecord;
  approval: ApprovalRow | null;
  canAct: boolean;
  canEdit: boolean;
  advanceStep: AdvanceStep | null;
  linkedRequests: LinkedRequest[];
}

export interface ReconcileMatch {
  requestId: string;
  employeeName: string;
  bkashNumber: string;
  expectedAmount: number;
  fileAmount: number;
  amountDiff: number;
  confidence: "exact" | "close" | "mismatch";
  receiptNo: string;
  completionDate: string;
  requestStatus: string;
}

export interface ReconcileUnmatchedClaim {
  requestId: string;
  employeeName: string;
  bkashNumber: string;
  expectedAmount: number;
  status: string;
}

export interface ReconcileUnmatchedFileRow {
  receiptNo: string;
  completionDate: string;
  amount: number;
  bkashNumber: string;
  rawOppositeParty: string;
  status: string;
}

export interface ReconcileResult {
  matches: ReconcileMatch[];
  unmatchedClaims: ReconcileUnmatchedClaim[];
  unmatchedFileRows: ReconcileUnmatchedFileRow[];
}

export interface EmployeeLite {
  employeeId: string;
  name: string;
  email: string;
  department: string;
  designation: string;
  band: string;
  gender: string;
}

/**
 * The public URL of an uploaded file, wherever the file service puts it in its
 * response: a value under a url-like key if there is one, otherwise the first
 * http(s) string found.
 */
function findFileUrl(value: unknown): string {
  const isUrl = (v: unknown): v is string => typeof v === "string" && /^https?:\/\//i.test(v);
  const preferred = /^(url|location|link|cdn_?url|public_?url|file_?url|path)$/i;
  const walk = (v: unknown, onlyPreferred: boolean): string => {
    if (isUrl(v) && !onlyPreferred) return v;
    if (Array.isArray(v)) {
      for (const x of v) { const f = walk(x, onlyPreferred); if (f) return f; }
    } else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        if (isUrl(x) && (!onlyPreferred || preferred.test(k))) return x;
      }
      for (const x of Object.values(v)) { const f = walk(x, onlyPreferred); if (f) return f; }
    }
    return "";
  };
  return walk(value, true) || walk(value, false);
}

export const api = {
  uploadConfig: () => call<{ enabled: boolean; maxBytes: number }>("/uploads/config"),

  /**
   * Uploads one file straight from the browser to the 10MS file service, so it
   * never passes through the server and is not limited by a serverless request
   * body. The server only decides the name and key. Every failure says what
   * went wrong, using the service's own words where it gave any.
   */
  upload: async (
    file: File,
    index: number,
    onProgress?: (fraction: number) => void,
  ): Promise<{ id: string; name: string; link: string; sizeBytes: number }> => {
    // Each step names itself in its error, so a bare "Failed to fetch" always says where it happened.
    const plan = await post<{
      endpoint: string; bucket: string; acl: string; key: string; name: string;
    }>("/uploads/session", { name: file.name, mimeType: file.type || "application/octet-stream", size: file.size, index })
      .catch((err: Error) => {
        throw new Error(`Step 1 of 3 — could not start the upload on this app's server: ${err.message}`);
      });

    const token = await auth.getAccessToken().catch((err: Error) => {
      throw new Error(`Step 2 of 3 — could not get your 10 Minute School access token: ${err.message}. Sign out and sign in again.`);
    });
    if (!token) throw new Error("Step 2 of 3 — you have no 10 Minute School access token. Sign out and sign in again.");

    const form = new FormData();
    form.append("bucket", plan.bucket);
    form.append("acl", plan.acl);
    form.append("key", plan.key);
    form.append("file", file, plan.name);

    const reply = await new Promise<unknown>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", plan.endpoint, true);
      xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      xhr.setRequestHeader("accept", "application/json");
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
      };
      xhr.onload = () => {
        let body: unknown = null;
        try { body = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
        if (xhr.status >= 200 && xhr.status < 300 && body) {
          resolve(body);
          return;
        }
        const said = (body as { message?: unknown } | null)?.message;
        const detail = typeof said === "string" && said ? said : xhr.responseText.slice(0, 120);
        reject(new Error(`Step 3 of 3 — the file service refused the upload (${xhr.status}${detail ? `: ${detail}` : ""}).`));
      };
      xhr.onerror = () => reject(new Error(
        `Step 3 of 3 — could not reach the file service at ${new URL(plan.endpoint).host}. Check your connection, or whether it allows this site.`,
      ));
      xhr.send(form);
    });

    const link = findFileUrl(reply);
    if (!link) {
      console.error("[upload] no file URL in the response:", reply);
      throw new Error("Step 3 of 3 — the file was uploaded, but the service's reply had no file address, so it cannot be attached.");
    }
    return { id: plan.key, name: plan.name, link, sizeBytes: file.size };
  },

  /** Exchanges a verified 10 Minute School access token for an app session. */
  tenmsLogin: (accessToken: string) =>
    post<{ token: string; user: SessionUser }>("/auth/tenms", { accessToken }),
  me: () => call<{ user: SessionUser }>("/me"),
  saveBkashNumber: (bkashNumber: string) => post<{ ok: boolean; bkashNumber: string }>("/me/bkash", { bkashNumber }),
  saveTeammateBkash: (employeeId: string, bkashNumber: string) =>
    post<{ ok: boolean; employeeId: string; bkashNumber: string }>(`/employees/${encodeURIComponent(employeeId)}/bkash`, { bkashNumber }),
  policy: () => call<Policy>("/policy"),
  insideCityBlock: () => call<{ entries: InsideCityBlockEntry[] }>("/admin/inside-city-block"),
  addInsideCityBlock: (email: string, note: string) =>
    post<{ entry: InsideCityBlockEntry }>("/admin/inside-city-block", { email, note }),
  updateInsideCityBlock: (currentEmail: string, email: string, note: string) =>
    call<{ entry: InsideCityBlockEntry }>(`/admin/inside-city-block/${encodeURIComponent(currentEmail)}`, {
      method: "PUT",
      body: JSON.stringify({ email, note }),
    }),
  removeInsideCityBlock: (email: string) =>
    call<{ ok: boolean }>(`/admin/inside-city-block/${encodeURIComponent(email)}`, { method: "DELETE" }),
  roleGrants: () => call<{ grants: RoleGrant[]; defaultAdmins: string[] }>("/admin/roles"),
  grantRole: (email: string, role: RoleGrant["role"]) => post<{ grant: RoleGrant }>("/admin/roles", { email, role }),
  revokeRole: (email: string, role: RoleGrant["role"]) =>
    call<{ ok: boolean }>("/admin/roles", { method: "DELETE", body: JSON.stringify({ email, role }) }),
  employees: async (q: string) =>
    call<{ employees: EmployeeLite[] }>(`/employees?q=${encodeURIComponent(q)}`, {
      // The directory is searched with the person's own 10MS token.
      headers: { "X-TenMS-Token": (await auth.getAccessToken().catch(() => "")) || "" },
    }),

  requests: (scope: string) =>
    call<{ requests: RequestListItem[]; summary: Summary; inbox: number; desk: DeskSummary }>(
      `/requests?scope=${scope}`,
    ),
  request: (id: string) => call<RequestDetail>(`/requests/${encodeURIComponent(id)}`),
  preview: (draft: RequestDraft) =>
    post<{ computation: Computation; modes: ModeOption[] }>("/requests/preview", { draft }),
  create: (draft: RequestDraft, submit: boolean) =>
    post<{ request: RequestRecord; computation: Computation }>("/requests", { draft, submit }),
  update: (id: string, draft: RequestDraft, submit: boolean) =>
    call<{ request: RequestRecord; computation: Computation }>(`/requests/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify({ draft, submit }),
    }),
  act: (id: string, action: string, remarks: string, approvedAmount?: number) =>
    post<{ request: RequestRecord }>(`/requests/${encodeURIComponent(id)}/action`, {
      action, remarks, approvedAmount,
    }),
  saveCompanyAmounts: (
    id: string,
    entries: { employeeId: string; companyTransportAmount: number; companyAccommodationAmount: number }[],
  ) =>
    post<{ request: RequestRecord }>(`/requests/${encodeURIComponent(id)}/company-amounts`, { entries }),
  pay: (id: string, payload: Record<string, unknown>) =>
    post<{ request: RequestRecord }>(`/requests/${encodeURIComponent(id)}/payment`, payload),
  reconcilePreview: (contentBase64: string) =>
    post<ReconcileResult>("/requests/payment-reconcile/preview", { contentBase64 }),
  reconcileConfirm: (filename: string, matches: ReconcileMatch[]) =>
    post<{ results: { requestId: string; ok: boolean; error?: string }[] }>(
      "/requests/payment-reconcile/confirm",
      { filename, matches },
    ),
  acknowledge: (id: string, received: boolean, note = "") =>
    post<{ request: RequestRecord }>(`/requests/${encodeURIComponent(id)}/acknowledge`, { received, note }),

  claimUnlock: (employeeId: string, from: string) =>
    post<{ ok: boolean; employeeId: string; from: string }>("/admin/claim-unlock", { employeeId, from }),

  requestUnlock: (reason: string, requestedFrom: string) =>
    post<{ request: UnlockRequest }>("/unlock-requests", { reason, requestedFrom }),
  unlockRequests: (scope: "mine" | "pending" | "all" = "mine") =>
    call<{ requests: UnlockRequest[] }>(`/unlock-requests?scope=${scope}`),
  decideUnlock: (id: string, action: "approve" | "reject", remarks: string, unlockFrom?: string) =>
    post<{ request: UnlockRequest }>(`/unlock-requests/${encodeURIComponent(id)}/decide`, { action, remarks, unlockFrom }),

  myVehicle: () => call<{ vehicle: VehicleRegistration | null }>("/vehicles/mine"),
  registerVehicle: (payload: { vehicleType: string; model: string; fuelType: string; mileageKmPerLitre: number; imageLink?: string }) =>
    post<{ vehicle: VehicleRegistration }>("/vehicles", payload),
  vehicles: (scope: "pending" | "all" = "pending") =>
    call<{ vehicles: VehicleRegistration[] }>(`/vehicles?scope=${scope}`),
  decideVehicle: (employeeId: string, action: "approve" | "reject", remarks: string) =>
    post<{ vehicle: VehicleRegistration }>(`/vehicles/${encodeURIComponent(employeeId)}/decide`, { action, remarks }),

  advances: (scope: "mine" | "desk") =>
    call<{ requests: (RequestRecord & { myStep: AdvanceStep | null })[] }>(`/advances?scope=${scope}`),
  advanceAction: (id: string, payload: Record<string, unknown>) =>
    post<{ request: RequestRecord }>(`/requests/${encodeURIComponent(id)}/advance`, payload),

  adminTabs: () =>
    call<{ tabs: string[]; headers: Record<string, string[]>; data: Record<string, Record<string, string>[]> }>(
      "/admin/tabs",
    ),
  saveTab: (tab: string, rows: Record<string, string>[]) =>
    post<{ ok: boolean }>(`/admin/tabs/${encodeURIComponent(tab)}`, { rows }),

  /**
   * The bKash bulk-disbursement workbook — binary, not JSON, so this bypasses
   * `call` and reads the response as a Blob instead.
   */
  paymentExport: async (ids: string[]): Promise<{ blob: Blob; filename: string; skipped: string[]; skippedTravellers: string[] }> => {
    const res = await fetch("/api/requests/payment-export", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      },
      body: JSON.stringify({ ids }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Request failed (${res.status})`);
    }
    const filename = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "")?.[1] || "bkash-payment.xlsx";
    const skippedHeader = res.headers.get("X-Skipped-Ids");
    const skipped = skippedHeader ? decodeURIComponent(skippedHeader).split(",") : [];
    const skippedTravellersHeader = res.headers.get("X-Skipped-Travellers");
    const skippedTravellers = skippedTravellersHeader ? decodeURIComponent(skippedTravellersHeader).split(",") : [];
    return { blob: await res.blob(), filename, skipped, skippedTravellers };
  },
};
