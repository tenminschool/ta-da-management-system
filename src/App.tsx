import { useCallback, useEffect, useState } from "react";
import {
  Banknote, Car, FileText, HandCoins, Inbox, LayoutDashboard, ListChecks,
  LogOut, Menu, Plus, Settings, ShieldCheck, User, Wallet, X,
} from "lucide-react";
import { useTenMSAuth } from "@tenminuteschool/auth-admin-react";
import { api, clearToken, getToken, setToken, setUnauthorizedHandler } from "./api.js";
import { HOST_OWNS_SESSION } from "./lib/embed.js";
import type { Policy, RequestDraft, SessionUser, StatusGroup } from "../shared/types.js";
import Login from "./components/Login.js";
import Dashboard from "./components/Dashboard.js";
import NewRequest from "./components/NewRequest.js";
import RequestList from "./components/RequestList.js";
import RequestDetail from "./components/RequestDetail.js";
import Advances from "./components/Advances.js";
import AdminConfig from "./components/AdminConfig.js";
import Reports from "./components/Reports.js";
import VehicleRegistrations from "./components/VehicleRegistrations.js";
import VehicleRegisterPage from "./components/VehicleRegister.js";
import { Spinner } from "./components/ui.js";

/**
 * Two workspaces, never mixed: "self" is what the person claims, "desk" is
 * what they decide on for other people. Approvers switch between them; everyone
 * else only ever sees "self".
 */
type Workspace = "self" | "desk";

type View =
  | { name: "new"; editing?: { draft: RequestDraft; requestId: string } }
  | { name: "detail"; requestId: string }
  // `name` is a plain string on the catch-all, so the group has to live there
  // too — TypeScript cannot discriminate a union on a non-literal.
  | { name: string; group?: StatusGroup };

interface NavItem {
  key: string;
  label: string;
  /** Shorter label for the mobile tab bar. */
  short: string;
  icon: typeof LayoutDashboard;
  badge?: number;
}

export default function App() {
  const { user: tenmsUser, loading: authLoading, auth, refresh: refreshSession } = useTenMSAuth();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [booting, setBooting] = useState(true);
  const [workspace, setWorkspace] = useState<Workspace>("self");
  const [view, setView] = useState<View>({ name: "dashboard" });
  const [menuOpen, setMenuOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [inbox, setInbox] = useState(0);
  const [signInError, setSignInError] = useState("");

  const bootstrap = useCallback(async (signedIn: SessionUser) => {
    setUser(signedIn);
    const [p, r] = await Promise.all([api.policy(), api.requests("mine").catch(() => null)]);
    setPolicy(p);
    if (r) setInbox(r.inbox);
  }, []);

  /**
   * A 401 mid-session drops straight back to the sign-in screen. It must never
   * navigate or reload: the provider session outlives an app token, so a reload
   * would just re-exchange it, fail the same way and reload again — which is
   * what made the page flicker when embedded in another site.
   */
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      setPolicy(null);
      setView({ name: "dashboard" });
      setWorkspace("self");
      setSignInError("Your session has expired. Please sign in again.");
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
          refreshSession();
        }
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();

    return () => { cancelled = true; };
  }, [authLoading, tenmsUser, auth, bootstrap, refreshSession]);

  if (booting || authLoading) return <Spinner label="Starting up…" />;
  if (!user) {
    return (
      <Login
        notice={signInError}
        onSignedIn={(u) => {
          setSignInError("");
          setBooting(true);
          bootstrap(u).finally(() => setBooting(false));
        }}
      />
    );
  }
  if (!policy) return <Spinner label="Loading policy…" />;

  // "Do you approve anything?" — a role from the sheet, or reports of your own.
  const isFinance = user.roles.includes("finance");
  const isAdmin = user.roles.some((r) => ["admin", "hr"].includes(r));
  const isApprover = isAdmin || isFinance || !!user.managesOthers;
  const reviewsAdvances = isAdmin || isFinance || !!user.managesOthers;

  const selfNav: NavItem[] = [
    { key: "dashboard", label: "Dashboard", short: "Home", icon: LayoutDashboard },
    { key: "my-requests", label: "My Requests", short: "Claims", icon: FileText },
    { key: "my-advance", label: "My Advance", short: "Advance", icon: HandCoins },
    { key: "my-payments", label: "My Payments", short: "Paid", icon: Wallet },
    { key: "my-vehicle", label: "Register your Vehicle", short: "Vehicle", icon: Car },
  ];

  const deskNav: NavItem[] = ([
    { key: "desk-reports", label: "Dashboard", short: "Home", icon: LayoutDashboard, show: isAdmin || isFinance },
    { key: "desk-all", label: "All Claims", short: "All", icon: ListChecks, show: true },
    { key: "desk-pending", label: "Pending Approvals", short: "Pending", icon: Inbox, show: true, badge: inbox },
    { key: "desk-advances", label: "Advance Approvals", short: "Advance", icon: HandCoins, show: reviewsAdvances },
    { key: "desk-vehicles", label: "Vehicle Registrations", short: "Vehicles", icon: Car, show: isAdmin },
    { key: "desk-payments", label: "Payments", short: "Pay", icon: Banknote, show: isFinance || isAdmin },
    { key: "admin", label: "Configuration", short: "Config", icon: Settings, show: isAdmin },
  ] as (NavItem & { show: boolean })[]).filter((n) => n.show).map(({ show: _show, ...n }) => n);

  const nav = workspace === "self" ? selfNav : deskNav;
  // The phone tab bar only has room for a few — the rest stay in the drawer.
  const mobileNav = nav.slice(0, 4);

  // A dashboard card arrives as "my-requests:returned" — the list it opens is
  // the same one the sidebar opens, just narrowed to that card.
  const go = (name: string) => {
    const [view, group] = name.split(":");
    setView(group ? { name: view, group: group as StatusGroup } : { name: view });
    setMenuOpen(false);
  };
  const refresh = () => setRefreshKey((k) => k + 1);

  async function signOut() {
    clearToken();
    try {
      await auth.logout();
    } finally {
      // The provider does not observe storage on its own.
      refreshSession();
      // Re-render into the signed-out state rather than navigating: embedded in
      // another site, navigating only reloads the frame, and the handoff token
      // in the URL would sign the person straight back in.
      setUser(null);
      setPolicy(null);
      setWorkspace("self");
      setView({ name: "dashboard" });
      setSignInError("");
    }
  }

  // Landing on the desk means landing on its first screen, whatever that is for
  // this person — a line manager has no Dashboard.
  const deskHome = deskNav[0]?.key || "desk-all";

  const switchWorkspace = (next: Workspace) => {
    setWorkspace(next);
    setView({ name: next === "self" ? "dashboard" : deskHome });
    setMenuOpen(false);
  };

  const WorkspaceSwitch = ({ compact = false }: { compact?: boolean }) => (
    <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
      <button
        onClick={() => switchWorkspace("self")}
        className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold transition ${
          workspace === "self" ? "bg-white text-brand-700 shadow-sm" : "text-slate-500"
        }`}
      >
        <User size={13} /> {compact ? "Mine" : "My Claims"}
      </button>
      <button
        onClick={() => switchWorkspace("desk")}
        className={`relative flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold transition ${
          workspace === "desk" ? "bg-white text-brand-700 shadow-sm" : "text-slate-500"
        }`}
      >
        <ShieldCheck size={13} /> Approvals
        {inbox > 0 && workspace !== "desk" && (
          <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-white">
            {inbox}
          </span>
        )}
      </button>
    </div>
  );

  return (
    <div className="min-h-full lg:flex">
      {/* Sidebar — a drawer on phones, always-on from lg up */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] shrink-0 flex-col border-r border-slate-200 bg-white transition-transform duration-200 lg:static lg:w-64 lg:max-w-none lg:translate-x-0 ${
          menuOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-16 shrink-0 items-center gap-2.5 border-b border-slate-200 px-5">
          <img
            src="/logo.png"
            alt="10 Minute School"
            width={32}
            height={32}
            className="size-8 shrink-0 rounded-lg object-contain"
          />
          <span className="text-sm font-bold leading-tight text-slate-800">
            TA & Per-Diem
            <span className="block text-xs font-normal text-slate-400">PeopleOps</span>
          </span>
          <button
            className="-mr-2 ml-auto rounded-lg p-2 text-slate-400 hover:bg-slate-100 lg:hidden"
            onClick={() => setMenuOpen(false)}
            aria-label="Close menu"
          >
            <X size={20} />
          </button>
        </div>

        {isApprover && (
          <div className="border-b border-slate-200 p-3">
            <p className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Workspace</p>
            <WorkspaceSwitch />
          </div>
        )}

        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3">
          {nav.map(({ key, label, icon: Icon, badge }) => (
            <button
              key={key}
              onClick={() => go(key)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                view.name === key ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <Icon size={16} />
              <span className="flex-1 text-left">{label}</span>
              {badge ? (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">{badge}</span>
              ) : null}
            </button>
          ))}
        </nav>

        <div className="shrink-0 border-t border-slate-200 p-3">
          <div className="mb-2 px-2">
            <p className="truncate text-sm font-semibold text-slate-700">{user.name}</p>
            <p className="truncate text-xs text-slate-400">Band {user.band} · {user.department}</p>
          </div>
          {/* The host owns the session when this panel is embedded — signing
              out here would strand the two out of step. */}
          {!HOST_OWNS_SESSION && (
            <button
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
              onClick={() => void signOut()}
            >
              <LogOut size={16} /> Sign out
            </button>
          )}
        </div>
      </aside>

      {menuOpen && (
        <div className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden" onClick={() => setMenuOpen(false)} />
      )}

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-slate-200 bg-white/95 px-3 backdrop-blur sm:h-16 sm:px-4 lg:px-8">
          <button
            className="-ml-1 rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:hidden"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
          >
            <Menu size={20} />
          </button>
          <img
            src="/logo.png"
            alt="10 Minute School"
            width={28}
            height={28}
            className="size-7 shrink-0 rounded-lg object-contain sm:hidden"
          />
          <span className={`hidden rounded-full px-3 py-1 text-xs font-semibold ring-1 sm:inline-flex ${
            workspace === "self"
              ? "bg-slate-50 text-slate-600 ring-slate-200"
              : "bg-brand-50 text-brand-700 ring-brand-200"
          }`}>
            {workspace === "self" ? "My Claims" : "Approval Desk"}
          </span>
          <div className="flex-1" />
          {workspace === "self" && (
            <button
              className="btn-primary !px-3 !py-2 text-xs sm:!px-4 sm:text-sm"
              onClick={() => setView({ name: "new" })}
            >
              <Plus size={15} />
              New<span className="hidden sm:inline">&nbsp;Request</span>
            </button>
          )}
        </header>

        {/* Workspace switch is worth a permanent slot on phones */}
        {isApprover && (
          <div className="border-b border-slate-200 bg-white px-3 py-2 lg:hidden">
            <WorkspaceSwitch compact />
          </div>
        )}

        <main className="mx-auto w-full max-w-6xl flex-1 p-3 pb-24 sm:p-4 lg:p-8 lg:pb-8">
          {/* ── My Claims workspace ── */}
          {view.name === "dashboard" && (
            <Dashboard
              user={user}
              onOpen={(requestId) => setView({ name: "detail", requestId })}
              onGoto={go}
            />
          )}

          {view.name === "new" && (
            <NewRequest
              user={user}
              policy={policy}
              editing={(view as { editing?: { draft: RequestDraft; requestId: string } }).editing}
              onDone={(requestId) => { refresh(); setView({ name: "detail", requestId }); }}
              onCancel={() => setView({ name: "dashboard" })}
            />
          )}

          {view.name === "my-requests" && (
            <RequestList
              scope="mine"
              showEmployee={false}
              refreshKey={refreshKey}
              group={(view as { group?: StatusGroup }).group}
              title="My Requests"
              subtitle="Every claim you have raised, with its live status."
              onOpen={(requestId) => setView({ name: "detail", requestId })}
              onClearGroup={() => setView({ name: "my-requests" })}
            />
          )}

          {view.name === "my-advance" && (
            <Advances scope="mine" policy={policy} onOpen={(requestId) => setView({ name: "detail", requestId })} />
          )}

          {view.name === "my-payments" && (
            <RequestList
              scope="mine_payments"
              showEmployee={false}
              refreshKey={refreshKey}
              title="My Payments"
              subtitle="Your claims that reached payment — processing, paid and completed."
              onOpen={(requestId) => setView({ name: "detail", requestId })}
            />
          )}

          {view.name === "my-vehicle" && <VehicleRegisterPage policy={policy} />}

          {/* ── Approval Desk workspace ── */}
          {view.name === "desk-pending" && (
            <RequestList
              scope="pending"
              refreshKey={refreshKey}
              showFilters
              title="Pending Approvals"
              subtitle="Other people's requests waiting on your decision right now."
              onOpen={(requestId) => setView({ name: "detail", requestId })}
            />
          )}

          {view.name === "desk-advances" && (
            <Advances scope="desk" policy={policy} onOpen={(requestId) => setView({ name: "detail", requestId })} />
          )}

          {view.name === "desk-vehicles" && <VehicleRegistrations policy={policy} />}

          {view.name === "desk-payments" && (
            <RequestList
              scope="desk_payments"
              refreshKey={refreshKey}
              selectable
              quickFilters={[
                { key: "finance_review", label: "Pending approval", statuses: ["finance_review"] },
                { key: "payment_processing", label: "Pending payment", statuses: ["payment_processing"] },
                { key: "paid", label: "Paid", statuses: ["paid", "completed"] },
              ]}
              title="Payments"
              subtitle="Claims waiting on Finance — to approve, to pay, and already paid."
              onOpen={(requestId) => setView({ name: "detail", requestId })}
            />
          )}

          {view.name === "desk-reports" && (
            <Reports policy={policy} user={user} onOpen={(requestId) => setView({ name: "detail", requestId })} />
          )}

          {view.name === "desk-all" && (
            <RequestList
              // Admin / Finance / HR get the full register including their own
              // claims; a line manager still only sees their reports'.
              scope={isAdmin || isFinance ? "everything" : "desk"}
              showFilters
              refreshKey={refreshKey}
              title="All Claims"
              subtitle="Every claim you oversee, newest first. Filter by department, stage or person."
              onOpen={(requestId) => setView({ name: "detail", requestId })}
            />
          )}

          {view.name === "admin" && <AdminConfig />}

          {view.name === "detail" && (
            <RequestDetail
              requestId={(view as { requestId: string }).requestId}
              user={user}
              policy={policy}
              onBack={() => setView({ name: workspace === "self" ? "dashboard" : deskHome })}
              onEdit={(draft, requestId) => {
                setWorkspace("self");
                setView({ name: "new", editing: { draft, requestId } });
              }}
              onChanged={() => {
                refresh();
                api.requests("mine").then((r) => setInbox(r.inbox)).catch(() => {});
              }}
            />
          )}
        </main>

        {/* Phone tab bar */}
        <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
          {mobileNav.map(({ key, short, icon: Icon, badge }) => (
            <button
              key={key}
              onClick={() => go(key)}
              className={`relative flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold transition ${
                view.name === key ? "text-brand-700" : "text-slate-500"
              }`}
            >
              <Icon size={18} />
              {short}
              {badge ? (
                <span className="absolute right-1/4 top-1.5 flex size-4 items-center justify-center rounded-full bg-amber-500 text-[9px] font-bold text-white">
                  {badge}
                </span>
              ) : null}
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}
