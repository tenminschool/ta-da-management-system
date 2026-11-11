/**
 * Server-side verification of a "Login with 10 Minute School" session.
 *
 * The browser finishes the OAuth flow and ends up holding an access token. It
 * then sends that token here — never an email address. Trusting an email from
 * the browser would let anyone sign in as anyone, so the token is exchanged
 * for a profile at the provider's own userinfo endpoint, and only the email
 * that comes back is used to identify the person.
 */

const BASE_URL = (process.env.TENMS_AUTH_BASE_URL || "https://api.10minuteschool.com/auth").replace(/\/$/, "");

export interface TenMSUser {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
  phone?: string;
  email_verified?: boolean;
  /** Roles the provider already holds for this account, in whatever shape it sends them. */
  /** The whole `/v1/admin/me` record, for the fields the app maps. */
  record: TenMSRecord;
}

export class TenMSVerifyError extends Error {
  constructor(message: string, readonly status = 401) {
    super(message);
  }
}

async function ask(path: string, accessToken: string): Promise<Response> {
  try {
    return await fetch(`${BASE_URL}${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  } catch {
    throw new TenMSVerifyError("Could not reach the 10 Minute School sign-in service. Try again.", 503);
  }
}

/** The signed-in admin's full HR record — what the SDK's getMyProfile() reads. Empty if it cannot be fetched. */
async function fetchOwnProfile(accessToken: string, id: string): Promise<Record<string, unknown>> {
  try {
    const res = await ask(`/v1/admin/profile/${encodeURIComponent(id)}`, accessToken);
    if (!res.ok) return {};
    const body = (await res.json()) as { data?: { user?: Record<string, unknown> } };
    return body?.data?.user ?? {};
  } catch {
    return {};
  }
}

/**
 * Resolves an access token to the signed-in admin, as `/v1/admin/me` reports
 * them — the same call the SDK uses to validate a session. It answers for both
 * kinds of token in circulation (our own OAuth flow, and a handoff from another
 * 10MS app that arrives as `?tenms_token=…`), and its `data.user` record carries
 * the employee's details, so nothing else needs to be asked.
 *
 * `/v1/oauth/userinfo` is only a fallback for identity alone.
 */
export async function verifyAccessToken(accessToken: string): Promise<TenMSUser> {
  if (!accessToken) throw new TenMSVerifyError("No access token was supplied.", 400);

  const admin = await ask("/v1/admin/me", accessToken);
  if (admin.ok) {
    const body = (await admin.json()) as { data?: { user?: Record<string, unknown> } };
    const u = body?.data?.user;
    if (u && typeof u.id === "string" && u.id) {
      // `/me` can leave out the HR fields (position, department…) that the SDK's own
      // getMyProfile() returns from `/v1/admin/profile/{id}`, so that record fills any gaps.
      const full = await fetchOwnProfile(accessToken, u.id);
      const merged: Record<string, unknown> = { ...u };
      for (const [k, v] of Object.entries(full)) {
        if (v !== null && v !== undefined && v !== "" && (merged[k] === undefined || merged[k] === null || merged[k] === "")) merged[k] = v;
      }
      return {
        sub: u.id,
        email: typeof u.username === "string" ? u.username : undefined,
        name: typeof u.name === "string" ? u.name : undefined,
        picture: typeof u.profile_img === "string" ? u.profile_img : undefined,
        phone: typeof u.phone_number === "string" ? u.phone_number : undefined,
        record: merged as TenMSRecord,
      };
    }
    throw new TenMSVerifyError("The sign-in service returned an incomplete profile.", 502);
  }

  if (admin.status === 401 || admin.status === 403) {
    const userinfo = await ask("/v1/oauth/userinfo", accessToken);
    if (userinfo.ok) {
      const profile = (await userinfo.json()) as TenMSUser;
      if (!profile?.sub) throw new TenMSVerifyError("The sign-in service returned an incomplete profile.", 502);
      return { ...profile, record: {} };
    }
    throw new TenMSVerifyError("Your sign-in session is not valid any more. Please sign in again.", 401);
  }

  throw new TenMSVerifyError(`The sign-in service rejected the token (${admin.status}).`, 401);
}

/** The slice of the `/v1/admin/me` `data.user` record this app reads. Blank strings mean "not set". */
export interface TenMSRecord {
  employee_id?: string;
  gender?: string;
  band?: string;
  current_hr_position?: string;
  designation?: string;
  job_role?: string;
  current_department?: string;
  employee_status?: string;
  department?: string;
  /** The line manager's display name (no ID or email), e.g. "Md. Mahmud Siddik". */
  supervisor?: string;
  /** The line manager's own employee ID and email, as the HR record holds them. */
  supervisor_employee_id?: string;
  supervisor_email?: string;
  phone_number?: string;
  /** The employee's bKash wallet number, as HR holds it. */
  bkash_number?: string;
  profile_img?: string;
  groups?: string[];
  teams?: { id: string; name: string }[];
}

export interface TenMSPerson {
  employeeId: string;
  name: string;
  email: string;
  department: string;
  designation: string;
  band: string;
  gender: string;
  /** Their line manager's display name, as the HR record holds it. */
  supervisor: string;
  supervisorEmail: string;
}

/**
 * Searches the 10MS admin directory (`/v1/admin/all`) on behalf of the signed-in
 * person, using their own token. The list sits somewhere under `data` and the
 * response shape is not documented, so the first array found there is used.
 */
export async function searchAdmins(accessToken: string, q: string, limit = 25): Promise<TenMSPerson[]> {
  const res = await ask(`/v1/admin/all?skip=0&limit=${limit}&search=${encodeURIComponent(q)}`, accessToken);
  if (!res.ok) throw new TenMSVerifyError(`The employee directory could not be searched (${res.status}).`, res.status === 401 ? 401 : 502);
  const body = (await res.json()) as { data?: unknown };
  const data = body?.data as unknown;
  const list: unknown[] = Array.isArray(data)
    ? data
    : (Object.values((data as object) || {}).find((v) => Array.isArray(v)) as unknown[] | undefined) ?? [];
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  return list
    .filter((u): u is Record<string, unknown> => !!u && typeof u === "object")
    .map((u) => ({
      employeeId: str(u.employee_id) || str(u.id),
      name: str(u.name),
      email: str(u.username) || str(u.email),
      department: str(u.current_department) || str(u.department),
      designation: str(u.designation) || str(u.job_role),
      band: str(u.band),
      gender: str(u.gender),
      supervisor: str(u.supervisor),
      supervisorEmail: str(u.supervisor_email).toLowerCase(),
    }))
    .filter((p) => p.employeeId && p.name);
}

/**
 * Resolves the HR record's `supervisor` (a display name only) to that person's
 * employee ID and email by searching the directory. Returns null unless
 * exactly one person has that name, so a duplicate name never routes a claim
 * to the wrong manager.
 */
export async function resolveSupervisor(
  accessToken: string,
  name: string,
): Promise<{ employeeId: string; email: string } | null> {
  const wanted = name.trim().replace(/\s+/g, " ").toLowerCase();
  if (!wanted) return null;
  try {
    const people = await searchAdmins(accessToken, name.trim(), 50);
    const same = people.filter((p) => p.name.trim().replace(/\s+/g, " ").toLowerCase() === wanted);
    if (same.length === 1) return { employeeId: same[0].employeeId, email: same[0].email.toLowerCase() };
    console.warn(`[tenms] supervisor "${name}" matched ${same.length} directory entries; not using it.`);
  } catch (err) {
    console.warn(`[tenms] supervisor lookup failed for "${name}":`, (err as Error).message);
  }
  return null;
}

/**
 * Band by HR position. The managerial and specialist paths sit on the same
 * band at each level, so both are listed together.
 */
const BAND_BY_POSITION: Record<string, string> = Object.fromEntries(
  Object.entries({
    A: ["CXO"],
    B: ["Senior Vice President", "Chief Specialist", "Vice President", "Assistant Vice President", "Principal Specialist"],
    C1: ["General Manager", "Manager", "Lead Specialist"],
    C2: ["Deputy Manager", "Senior Specialist", "Assistant Manager", "Specialist"],
    D: ["Senior Executive", "Executive"],
  }).flatMap(([band, names]) => names.map((n) => [n.toLowerCase(), band])),
);

/** Band E is a group of employment types rather than a ladder, so those match by keyword. */
const BAND_E_WORDS = ["temporary", "intern", "contractor", "part-time", "part time", "consultant", "project executive", "admin executive", "student advisor"];

/** Lower-case, abbreviations spelled out, punctuation turned into spaces. */
function tidy(position: string): string {
  return ` ${position
    .toLowerCase()
    .replace(/\bsr\.?(?=\s)/g, "senior")
    .replace(/\bjr\.?(?=\s)/g, "junior")
    .replace(/\basst\.?(?=\s)/g, "assistant")
    .replace(/\bdy\.?(?=\s)/g, "deputy")
    .replace(/\bvp\b/g, "vice president")
    .replace(/\bavp\b/g, "assistant vice president")
    .replace(/\bsvp\b/g, "senior vice president")
    .replace(/\bgm\b/g, "general manager")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
}

/** Known titles, longest first, so "Assistant Vice President" wins over "Vice President". */
const TITLES_LONGEST_FIRST = Object.entries(BAND_BY_POSITION)
  .map(([title, band]) => ({ title: ` ${tidy(title).trim()} `, band }))
  .sort((a, b) => b.title.length - a.title.length);

/**
 * The title may carry more than the level — "Senior Executive, Content" or
 * "Assistant Manager (Finance)" — so after an exact match fails, the longest
 * known title found as whole words inside it decides the band. Employment
 * types (band E) are checked first, since "Project Executive" would otherwise
 * read as an Executive.
 */
export function bandForPosition(position: string | undefined): string {
  const raw = String(position || "").trim();
  if (!raw) return "";
  const p = tidy(raw);
  const plain = raw.replace(/\s+/g, " ").toLowerCase();
  if (BAND_BY_POSITION[plain]) return BAND_BY_POSITION[plain];
  const wordsE = BAND_E_WORDS.map((w) => ` ${tidy(w).trim()} `);
  if (wordsE.some((w) => p.includes(w)) || BAND_E_WORDS.some((w) => plain.includes(w) && !/^[a-z]/.test(plain.slice(plain.indexOf(w) + w.length)))) return "E";
  const hit = TITLES_LONGEST_FIRST.find((t) => p.includes(t.title));
  if (hit) return hit.band;
  console.warn(`[band] no band matches the position "${raw}".`);
  return "";
}

/**
 * The permission names the signed-in admin holds, from `/v1/admin/user/permissions`
 * (the same call the SDK's getPermissions() makes). Only ACTIVE ones count: the
 * API returns a revoked permission as INACTIVE rather than leaving it out.
 *
 * Returns null when the list could not be read, so a failed call is not mistaken
 * for "this person has no permissions".
 */
export async function fetchPermissions(accessToken: string): Promise<string[] | null> {
  try {
    const res = await ask("/v1/admin/user/permissions?limit=-1", accessToken);
    if (!res.ok) {
      console.warn(`[tenms] permissions request failed (${res.status}).`);
      return null;
    }
    const body = (await res.json()) as { data?: { permissions?: unknown } };
    const list = body?.data?.permissions;
    if (!Array.isArray(list)) {
      console.warn("[tenms] permissions response had no data.permissions list.");
      return null;
    }
    return list
      .filter((p): p is { name: string; status: string } =>
        !!p && typeof p === "object" && typeof (p as { name?: unknown }).name === "string"
        && String((p as { status?: unknown }).status).toUpperCase() === "ACTIVE")
      .map((p) => p.name.trim());
  } catch (err) {
    console.warn("[tenms] permissions request failed:", (err as Error).message);
    return null;
  }
}
