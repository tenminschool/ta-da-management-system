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
      return {
        sub: u.id,
        email: typeof u.username === "string" ? u.username : undefined,
        name: typeof u.name === "string" ? u.name : undefined,
        picture: typeof u.profile_img === "string" ? u.profile_img : undefined,
        phone: typeof u.phone_number === "string" ? u.phone_number : undefined,
        record: u as TenMSRecord,
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
  designation?: string;
  job_role?: string;
  current_department?: string;
  department?: string;
  supervisor_employee_id?: string;
  line_manager?: string;
  phone_number?: string;
  groups?: string[];
  teams?: { id: string; name: string }[];
}
