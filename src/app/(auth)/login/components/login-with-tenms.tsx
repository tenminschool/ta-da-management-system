'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ExternalLink, KeyRound, Loader2 } from 'lucide-react';
import { LoginButton, useTenMSAuth } from '@tenminuteschool/auth-admin-react';
import {
  Button,
  ErrorAlert,
  Input,
  WarningAlert,
} from '@tenminuteschool/design-system';
import { api, setToken } from '@/lib/api';
import { CLIENT_ID, POST_LOGIN_REDIRECT } from '@/lib/auth';
import { IS_FRAMED } from '@/lib/embed';
import { useSession } from '@/hooks/use-session';
import type { SessionUser } from '@/shared/types';

/**
 * Sign-in is "Login with 10 Minute School".
 *
 * The SDK gets us a verified session; the app session comes from matching that
 * account's email against the Employees sheet, which is where band, department,
 * roles and line manager actually live.
 */
export function LoginWithTenMS() {
  const router = useRouter();
  const {
    auth,
    user: tenmsUser,
    loading: tenmsLoading,
    refresh,
  } = useTenMSAuth();
  const { user, booting, signInError, signIn } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(signInError);
  const [showRedirectHint, setShowRedirectHint] = useState(false);
  const [passwordAllowed, setPasswordAllowed] = useState(false);

  useEffect(() => {
    api
      .authMethods()
      .then((m) => setPasswordAllowed(m.password))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!booting && user) router.replace(POST_LOGIN_REDIRECT);
  }, [booting, user, router]);

  async function finishSignIn(
    exchange: () => Promise<{ token: string; user: SessionUser }>,
  ) {
    setBusy(true);
    setError('');
    try {
      const { token, user: signedIn } = await exchange();
      setToken(token);
      await signIn(signedIn);
      router.replace(POST_LOGIN_REDIRECT);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (!booting && user) return null;

  // The sign-in popup talks back to its opener with postMessage, which the
  // browser's Cross-Origin-Opener-Policy blocks when the opener is a
  // cross-origin frame. Signing in has to happen in a top-level tab.
  const embedded = IS_FRAMED;

  if (!CLIENT_ID) {
    return (
      <ErrorAlert
        title="Sign-in is not configured"
        message="Set NEXT_PUBLIC_TENMS_CLIENT_ID and restart."
      />
    );
  }

  return (
    <div className="space-y-5">
      {embedded ? (
        <Button asChild className="w-full" size="lg">
          <a
            href={typeof window !== 'undefined' ? window.location.href : '#'}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink className="size-4" /> Open in a new tab to sign in
          </a>
        </Button>
      ) : (
        <LoginButton
          clientId={CLIENT_ID}
          methods={['google']}
          size="large"
          text="Continue with Google"
          className="w-full"
          onSuccess={async (response) => {
            setBusy(true);
            setError('');
            try {
              // Persist the provider session, then tell the provider context
              // about it — it does not observe storage on its own.
              const session = await auth.handleLoginSuccess(response);
              refresh();
              // The server re-verifies this token with the provider before
              // trusting any email, then hands back our own app session.
              await finishSignIn(() => api.tenmsLogin(session.accessToken));
            } catch (err) {
              setError((err as Error).message);
              setBusy(false);
            }
          }}
          onError={(err) => {
            setError(err.message || 'Sign-in did not complete.');
            // A failed authorize step is almost always this origin missing
            // from the client's allow-list, which is invisible from here.
            setShowRedirectHint(true);
            setBusy(false);
          }}
        />
      )}
      {embedded && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          This page is embedded in another site, and the browser will not let a
          sign-in window talk back to it. Sign in once in a tab and this panel
          will work from then on.
        </p>
      )}

      {(busy || tenmsLoading) && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Matching your account…
        </p>
      )}

      {error && <ErrorAlert message={error} />}

      {showRedirectHint && (
        <WarningAlert
          title="This address may not be registered for the client."
          message={typeof window !== 'undefined' ? window.location.origin : ''}
        />
      )}

      {passwordAllowed && <PasswordFallback onSignedIn={finishSignIn} />}

      {!tenmsUser && !embedded && (
        <p className="text-center text-xs text-muted-foreground">
          Access restricted to authorized team members only.
        </p>
      )}
    </div>
  );
}

/**
 * Development-only way in, shown only when the server reports that password
 * sign-in is switched on. It stays hidden — and the endpoint stays closed — on
 * any deployment that does not set ALLOW_PASSWORD_LOGIN.
 */
function PasswordFallback({
  onSignedIn,
}: {
  onSignedIn: (
    exchange: () => Promise<{ token: string; user: SessionUser }>,
  ) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-2 text-xs font-semibold text-muted-foreground transition hover:text-foreground"
      >
        <KeyRound className="size-3.5" /> Use a password instead (development
        only)
      </button>
    );
  }

  return (
    <form
      className="space-y-3 rounded-xl border bg-muted/40 p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        await onSignedIn(() => api.login(email, password)).finally(() =>
          setBusy(false),
        );
      }}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Development sign-in
      </p>
      <Input
        type="email"
        autoComplete="username"
        placeholder="you@10ms.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <Input
        type="password"
        autoComplete="current-password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      <Button type="submit" className="w-full" disabled={busy}>
        {busy && <Loader2 className="size-4 animate-spin" />} Sign in
      </Button>
    </form>
  );
}
