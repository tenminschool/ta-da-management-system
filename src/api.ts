/** Typed fetch wrapper. Holds the session token and unwraps API errors. */

import type {
  ApprovalRow, Computation, Policy, RequestDraft, RequestRecord, SessionUser, VehicleRegistration,
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

export const api = {
  uploadConfig: () => call<{ enabled: boolean; maxBytes: number }>("/uploads/config"),

  /**
   * Uploads one file straight to Google Drive. The server only opens a
   * resumable session and finalises afterwards — the bytes never pass through
   * it, which is what allows files far larger than a serverless request body.
   */
  upload: async (
    file: File,
    index: number,
    onProgress?: (fraction: number) => void,
  ): Promise<{ id: string; name: string; link: string; sizeBytes: number }> => {
    const { uploadUrl } = await post<{ uploadUrl: string; name: string }>("/uploads/session", {
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      index,
    });

    const uploaded = await new Promise<{ id: string }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", uploadUrl, true);
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch {
            reject(new Error("Drive accepted the file but returned an unexpected response."));
          }
        } else {
          reject(new Error(`Drive rejected the upload (${xhr.status}).`));
        }
      };
      xhr.onerror = () => reject(new Error("The upload was interrupted. Check your connection and try again."));
      xhr.send(file);
    });

    const { file: saved } = await post<{ file: { id: string; name: string; link: string; sizeBytes: number } }>(
      "/uploads/finish",
      { fileId: uploaded.id },
    );
    return saved;
  },

  /** Which sign-in methods this deployment offers. */
  authMethods: () => call<{ password: boolean }>("/auth/methods"),
  /** Exchanges a verified 10 Minute School access token for an app session. */
  tenmsLogin: (accessToken: string) =>
    post<{ token: string; user: SessionUser }>("/auth/tenms", { accessToken }),
  login: (email: string, password: string) =>
    post<{ token: string; user: SessionUser }>("/login", { email, password }),
  me: () => call<{ user: SessionUser }>("/me"),
  saveBkashNumber: (bkashNumber: string) => post<{ ok: boolean; bkashNumber: string }>("/me/bkash", { bkashNumber }),
  policy: () => call<Policy>("/policy"),
  employees: (q: string) => call<{ employees: EmployeeLite[] }>(`/employees?q=${encodeURIComponent(q)}`),

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
