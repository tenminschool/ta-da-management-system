'use client';

import { createContext, useContext, useEffect } from 'react';

export const FullBleedContext = createContext<
  ((value: boolean) => void) | null
>(null);

/**
 * Opt a page out of the shell's padded, scrollable content card — it takes the
 * full card instead and owns its own scrolling (tables, embedded iframes, maps).
 */
export function useFullBleedPage() {
  const setFullBleed = useContext(FullBleedContext);

  useEffect(() => {
    setFullBleed?.(true);
    return () => setFullBleed?.(false);
  }, [setFullBleed]);
}
