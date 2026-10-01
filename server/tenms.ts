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
  roles?: unknown;
  role?: unknown;
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
 * Resolves an access token to the profile the provider vouches for.
 *
 * There are two kinds of token in circulation and the app cannot tell them
 * apart by looking:
 *
 *  - one from our own OAuth flow, which `/v1/oauth/userinfo` understands;
 *  - one handed over by another 10MS app that embeds this one — it arrives as
 *    `?tenms_token=…`, and only `/v1/admin/me` understands it.
 *
 * So both are tried. Sending a handoff token to userinfo alone just produced a
 * 401, which is why the embedded app could never sign anyone in.
 */
export async function verifyAccessToken(accessToken: string): Promise<TenMSUser> {
  if (!accessToken) throw new TenMSVerifyError("No access token was supplied.", 400);

  const userinfo = await ask("/v1/oauth/userinfo", accessToken);
  if (userinfo.ok) {
    const profile = (await userinfo.json()) as TenMSUser;
    if (!profile?.sub) throw new TenMSVerifyError("The sign-in service returned an incomplete profile.", 502);
    return profile;
  }

  // Not an OAuth token — it may still be a valid handoff token.
  if (userinfo.status === 401 || userinfo.status === 403) {
    const admin = await ask("/v1/admin/me", accessToken);
    if (admin.ok) {
      const body = (await admin.json()) as { data?: { user?: Record<string, unknown> } };
      const u = body?.data?.user;
      // The admin profile carries the email under `username`.
      if (u && typeof u.id === "string" && u.id) {
        return {
          sub: u.id,
          email: typeof u.username === "string" ? u.username : undefined,
          name: typeof u.name === "string" ? u.name : undefined,
          phone: typeof u.phone_number === "string" ? u.phone_number : undefined,
          picture: typeof u.profile_img === "string" ? u.profile_img : undefined,
          roles: u.roles,
          role: u.role,
        };
      }
      throw new TenMSVerifyError("The sign-in service returned an incomplete profile.", 502);
    }
    throw new TenMSVerifyError("Your sign-in session is not valid any more. Please sign in again.", 401);
  }

  throw new TenMSVerifyError(`The sign-in service rejected the token (${userinfo.status}).`, 401);
}

/** The slice of the SDK's `AdminProfile` (`/v1/admin/profile/{id}`) this app reads. */
export interface TenMSProfile {
  employee_code?: string;
  employee_id?: string;
  gender?: string;
  band?: string;
  designation?: string;
  current_department?: string;
  department?: string;
  job_role?: string;
  supervisor_employee_id?: string;
  supervisor_email?: string;
  line_manager?: string;
  work_phone?: string;
  phone_number?: string;
  groups?: string[];
}

/**
 * The HR record behind an account — what the SDK's `getMyProfile()` reads, done
 * here with the token we just verified. The API returns unset fields as the
 * literal string "(missing in get)"; those are dropped so they never read as data.
 * A failure yields an empty profile: sign-in has already succeeded.
 */
export async function fetchProfile(accessToken: string, id: string): Promise<TenMSProfile> {
  try {
    const res = await ask(`/v1/admin/profile/${encodeURIComponent(id)}`, accessToken);
    if (!res.ok) return {};
    // The record sits at `data.user`, the same place the SDK's getMyProfile() reads it.
    const body = (await res.json()) as { data?: { user?: Record<string, unknown> } };
    const raw = body?.data?.user ?? {};
    return Object.fromEntries(
      Object.entries(raw).filter(([, v]) => v !== "(missing in get)" && v !== null && v !== undefined),
    ) as TenMSProfile;
  } catch {
    return {};
  }
}
