import { useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { LoginButton, useTenMSAuth } from "@tenminuteschool/auth-admin-react";
import { api, setToken } from "../api.js";
import { CLIENT_ID, REDIRECT_URI } from "../lib/auth.js";
import { IS_FRAMED } from "../lib/embed.js";
import type { SessionUser } from "../../shared/types.js";

/**
 * Sign-in is "Login with 10 Minute School".
 *
 * The SDK gets us a verified session; the app session is built from that
 * account's own 10MS record, which is where band, department, roles and line
 * manager come from.
 */
export default function Login({
  onSignedIn,
  notice = "",
}: {
  onSignedIn: (user: SessionUser) => void;
  notice?: string;
}) {
  const { auth, refresh } = useTenMSAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(notice);
  const [showRedirectHint, setShowRedirectHint] = useState(false);

  // The sign-in popup talks back to its opener with postMessage, which the
  // browser's Cross-Origin-Opener-Policy blocks when the opener is a
  // cross-origin frame. Signing in has to happen in a top-level tab.
  const embedded = IS_FRAMED;

  if (!CLIENT_ID) {
    return (
      <Shell>
        <Card>
          <h2 className="text-lg font-bold text-rose-300">Sign-in is not configured</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">
            Set <code className="rounded bg-white/10 px-1.5 py-0.5 text-slate-200">VITE_TENMS_CLIENT_ID</code>{" "}
            and restart.
          </p>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell>
      <Card>
        <h2 className="text-2xl font-bold text-white">Sign in</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          Sign in with your 10MS account to access travel claims and approvals.
        </p>

        <div className="mt-7">
          {embedded ? (
            <a
              href={window.location.href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-white py-3 text-sm font-semibold text-slate-900 transition hover:bg-slate-100"
            >
              <ExternalLink size={16} /> Open in a new tab to sign in
            </a>
          ) : (
          <LoginButton
            clientId={CLIENT_ID}
            redirectUri={REDIRECT_URI}
            methods={["google"]}
            size="large"
            text="Continue with Google"
            onSuccess={async (response) => {
              setBusy(true);
              setError("");
              try {
                // Persist the provider session, then tell the provider context
                // about it — it does not observe storage on its own.
                const session = await auth.handleLoginSuccess(response);
                refresh();
                // The server re-verifies this token with the provider before
                // trusting any email, then hands back our own app session.
                const { token, user } = await api.tenmsLogin(session.accessToken);
                setToken(token);
                onSignedIn(user);
              } catch (err) {
                setError((err as Error).message);
                setBusy(false);
              }
            }}
            onError={(err) => {
              setError(err.message || "Sign-in did not complete.");
              // A failed authorize step is almost always this origin missing
              // from the client's allow-list, which is invisible from here.
              setShowRedirectHint(true);
              setBusy(false);
            }}
          />
          )}
          {embedded && (
            <p className="mt-3 text-xs leading-relaxed text-slate-500">
              This page is embedded in another site, and the browser will not let a sign-in window talk back to
              it. Sign in once in a tab and this panel will work from then on.
            </p>
          )}
        </div>

        {busy && (
          <p className="mt-5 flex items-center gap-2 text-sm text-slate-400">
            <Loader2 size={15} className="animate-spin" /> Matching your account…
          </p>
        )}

        {error && (
          <div className="mt-5 rounded-xl bg-rose-500/10 px-4 py-3 text-sm leading-relaxed text-rose-300 ring-1 ring-rose-500/20">
            {error}
          </div>
        )}

        {showRedirectHint && (
          <div className="mt-3 rounded-xl bg-amber-500/10 px-4 py-3 text-xs leading-relaxed text-amber-200 ring-1 ring-amber-500/20">
            <p className="font-semibold">This address may not be registered for the client.</p>
            <code className="mt-1.5 block break-all rounded bg-black/30 px-2 py-1 font-mono">{REDIRECT_URI}</code>
          </div>
        )}

      </Card>

      <p className="mt-8 text-center text-sm text-slate-500">
        Access restricted to authorized team members only.
      </p>
    </Shell>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-white/[0.04] p-7 ring-1 ring-white/10 sm:p-8">{children}</div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-[oklch(14.5%_0_0)] px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-10 flex flex-col items-center">
          {/* The mark already carries its own dark tile, so it sits straight on
              the background with nothing behind it. */}
          <img
            src="/logo.png"
            alt="10 Minute School"
            width={104}
            height={104}
            className="size-24 rounded-2xl object-contain sm:size-28"
          />
          <h1 className="mt-5 text-center text-xl font-bold text-white sm:text-2xl">
            Transportation Allowance &amp; Per-Diem
          </h1>
        </div>
        {children}
      </div>
    </div>
  );
}
