'use client';

import { HOST_OWNS_SESSION } from '@/lib/embed';

/**
 * True when the host (10MS HQ, or any `?source=hq` launcher) owns the sign-in
 * session, so this app's own account chrome — sign-out in particular — must
 * stay hidden. See `lib/embed.ts` for why mere framing isn't enough on its
 * own to decide this.
 */
export function useIsEmbedded(): boolean {
  return HOST_OWNS_SESSION;
}
