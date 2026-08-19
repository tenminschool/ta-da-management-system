'use client';

import * as React from 'react';

const LARGE_BREAKPOINT = 1024;

let mediaQuery: MediaQueryList | null = null;

function getMediaQuery() {
  if (!mediaQuery) {
    mediaQuery = window.matchMedia(`(min-width: ${LARGE_BREAKPOINT}px)`);
  }
  return mediaQuery;
}

function subscribe(onChange: () => void) {
  const mql = getMediaQuery();
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

/**
 * True on `lg` and up. The sidebar swaps between its desktop rail and a mobile
 * Sheet on this breakpoint, so the decision has to be readable in JS — a CSS
 * media query alone can't pick which tree to mount.
 *
 * Renders as `false` on the server and during hydration, then syncs to the real
 * viewport — so the mobile Sheet is the SSR-safe default.
 */
export function useIsLarge() {
  return React.useSyncExternalStore(
    subscribe,
    () => getMediaQuery().matches,
    () => false,
  );
}
