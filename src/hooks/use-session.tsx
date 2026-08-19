'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { useTenMSAuth } from '@tenminuteschool/auth-admin-react';
import {
  api,
  clearToken,
  getToken,
  setToken,
  setUnauthorizedHandler,
} from '@/lib/api';
import type { Policy, SessionUser } from '@/shared/types';

/**
 * ta-da's own app session — distinct from the raw 10MS provider session
 * `useAuth()`/`useTenMSAuth()` expose. This is what `/api/auth/tenms`
 * hands back after matching the 10MS account against the Employees sheet:
 * band, department, roles, line manager — never trusted from the provider.
 */
interface SessionContextValue {
  user: SessionUser | null;
  policy: Policy | null;
  /** True until the very first restore-or-redirect attempt has settled. */
  booting: boolean;
  /** How many claims are waiting on this person's desk right now. */
  inbox: number;
  signInError: string;
  /** Called by the Login screen once it has an app token + user in hand. */
  signIn: (user: SessionUser) => Promise<void>;
  refreshInbox: () => void;
  signOut: () => Promise<void>;
  isLoggingOut: boolean;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const {
    user: tenmsUser,
    loading: authLoading,
    auth,
    refresh: refreshTenms,
  } = useTenMSAuth();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [booting, setBooting] = useState(true);
  const [inbox, setInbox] = useState(0);
  const [signInError, setSignInError] = useState('');

  const bootstrap = useCallback(async (signedIn: SessionUser) => {
    setUser(signedIn);
    const [p, r] = await Promise.all([
      api.policy(),
      api.requests('mine').catch(() => null),
    ]);
    setPolicy(p);
    if (r) setInbox(r.inbox);
  }, []);

  /**
   * A 401 mid-session drops straight back to the sign-in screen (the
   * (dashboard) layout guard redirects once `user` goes null). It must never
   * navigate itself: the provider session outlives an app token, so a reload
   * would just re-exchange it, fail the same way and reload again.
   */
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      setPolicy(null);
      setSignInError('Your session has expired. Please sign in again.');
    });
  }, []);

  /**
   * Restores a session on load. An app token is used directly; otherwise, if
   * the SDK already has a 10 Minute School session (a returning visit, or a
   * cross-app handoff the provider just processed), it is silently exchanged
   * for one. Waits for the provider's own check to settle first so a handoff
   * in flight is not mistaken for "signed out".
   */
  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;

    (async () => {
      try {
        if (getToken()) {
          const { user: u } = await api.me();
          if (!cancelled) await bootstrap(u);
          return;
        }
        if (tenmsUser) {
          const accessToken = await auth.getAccessToken();
          if (accessToken) {
            const { token, user: u } = await api.tenmsLogin(accessToken);
            if (cancelled) return;
            setToken(token);
            await bootstrap(u);
            return;
          }
        }
      } catch (err) {
        clearToken();
        if (cancelled) return;
        // Say why. Silently falling back to a bare sign-in screen is how
        // "you are not in the Employees sheet" became invisible.
        setSignInError((err as Error).message);
        // A provider session that this app cannot exchange is worse than none:
        // it is retried on every load and never improves. Drop it so the next
        // attempt starts clean.
        if ((err as { status?: number }).status === 401) {
          await auth.logout().catch(() => {});
          refreshTenms();
        }
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authLoading, tenmsUser, auth, bootstrap, refreshTenms]);

  const signIn = useCallback(
    async (signedIn: SessionUser) => {
      setSignInError('');
      setBooting(true);
      try {
        await bootstrap(signedIn);
      } finally {
        setBooting(false);
      }
    },
    [bootstrap],
  );

  const refreshInbox = useCallback(() => {
    api
      .requests('mine')
      .then((r) => setInbox(r.inbox))
      .catch(() => {});
  }, []);

  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const signOut = useCallback(async () => {
    setIsLoggingOut(true);
    clearToken();
    try {
      await auth.logout();
    } finally {
      // The provider does not observe storage on its own.
      refreshTenms();
      setUser(null);
      setPolicy(null);
      setSignInError('');
      setIsLoggingOut(false);
    }
  }, [auth, refreshTenms]);

  return (
    <SessionContext.Provider
      value={{
        user,
        policy,
        booting: booting || authLoading,
        inbox,
        signInError,
        signIn,
        refreshInbox,
        signOut,
        isLoggingOut,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}
