/**
 * Stateless HMAC session tokens.
 *
 * The token carries the whole session, so no server-side session store is
 * needed and the app survives restarts / serverless cold starts. The signing
 * secret is derived from the service-account key already in the environment.
 */

import crypto from 'crypto';
import type { Role, SessionUser } from '../shared/types.js';

const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface Session extends SessionUser {
  expiresAt: number;
}

function secret(): string {
  return crypto
    .createHash('sha256')
    .update(process.env.GOOGLE_PRIVATE_KEY || 'ta-perdiem-dev-secret')
    .digest('hex');
}

export function signToken(user: SessionUser): string {
  const session: Session = { ...user, expiresAt: Date.now() + TTL_MS };
  const body = Buffer.from(JSON.stringify(session)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', secret())
    .update(body)
    .digest('base64url');
  return `${body}.${sig}`;
}

export function verifyToken(token: string | undefined): Session | null {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;

  const expected = crypto
    .createHmac('sha256', secret())
    .update(body)
    .digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const session = JSON.parse(
      Buffer.from(body, 'base64url').toString(),
    ) as Session;
    if (!session.expiresAt || session.expiresAt < Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

export function hasRole(session: Session, ...roles: Role[]): boolean {
  return roles.some((r) => session.roles.includes(r));
}
