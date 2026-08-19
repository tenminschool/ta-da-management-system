'use client';

import { useSearchParams } from 'next/navigation';

/**
 * True when this app runs inside a host shell — the 10MS HQ iframe, or any
 * launcher that appends `?source=hq`. The host supplies its own account chrome,
 * so the app hides its own user menus instead of stacking two.
 */
export function useIsEmbedded(): boolean {
  const searchParams = useSearchParams();

  if (searchParams.get('source') === 'hq') return true;
  return typeof window !== 'undefined' && window.self !== window.top;
}
