'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  BadgeCheck,
  Banknote,
  CircleDollarSign,
  Clock,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import { api, type Summary } from '@/lib/api';
import { useSession } from '@/hooks/use-session';
import {
  STATUS_GROUPS,
  type RequestRecord,
  type StatusGroup,
} from '@/shared/types';
import {
  Card,
  Empty,
  Money,
  ProgressBar,
  Spinner,
  StatusBadge,
} from '@/components/ui';

// Labels come from the shared group definitions, so a card can never be named
// one thing here and filtered as another.
const CARDS = [
  { key: 'pending', icon: Clock, tone: 'text-amber-600 bg-amber-50' },
  { key: 'approved', icon: BadgeCheck, tone: 'text-emerald-600 bg-emerald-50' },
  { key: 'rejected', icon: XCircle, tone: 'text-rose-600 bg-rose-50' },
  { key: 'returned', icon: RotateCcw, tone: 'text-orange-600 bg-orange-50' },
  {
    key: 'paymentPending',
    icon: Banknote,
    tone: 'text-indigo-600 bg-indigo-50',
  },
  {
    key: 'paid',
    icon: CircleDollarSign,
    tone: 'text-emerald-600 bg-emerald-50',
  },
] as const satisfies readonly {
  key: StatusGroup;
  icon: typeof Clock;
  tone: string;
}[];

/**
 * The employee's own home screen. Everything here is about claims this person
 * raised — approver duties live in the separate Approval Desk workspace.
 */
export function DashboardPage() {
  const router = useRouter();
  const { user } = useSession();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [requests, setRequests] = useState<RequestRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .requests('mine')
      .then((r) => {
        setSummary(r.summary);
        setRequests(r.requests);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading || !user) return <Spinner />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-bold sm:text-xl">
          Hello, {user.name.split(' ')[0]}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Band {user.band} · {user.designation} · {user.department}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-6">
        {CARDS.map(({ key, icon: Icon, tone }) => {
          const total = summary?.[key] ?? 0;
          return (
            <button
              key={key}
              type="button"
              // A count is only useful if you can get to what it counts.
              onClick={() => router.push(`/my-requests?group=${key}`)}
              disabled={!total}
              className="rounded-xl border bg-card p-3.5 text-left shadow-sm transition enabled:hover:border-primary/40 enabled:hover:shadow disabled:cursor-default sm:p-4"
              aria-label={`${total} ${STATUS_GROUPS[key].label.toLowerCase()} claim(s)`}
            >
              <div
                className={`mb-3 flex size-8 items-center justify-center rounded-lg ${tone}`}
              >
                <Icon size={16} />
              </div>
              <p className="text-xl font-bold tabular-nums sm:text-2xl">
                {total}
              </p>
              <p className="mt-0.5 text-xs font-medium text-muted-foreground">
                {STATUS_GROUPS[key].label}
              </p>
            </button>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border bg-card p-4 shadow-sm sm:p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Total Claims
          </p>
          <p className="mt-2 text-2xl font-bold sm:text-3xl">
            <Money value={summary?.totalClaims ?? 0} />
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Across {summary?.count ?? 0} request(s)
          </p>
        </div>
        <div className="rounded-xl border bg-card p-4 shadow-sm sm:p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Total Received
          </p>
          <p className="mt-2 text-2xl font-bold text-emerald-600 sm:text-3xl">
            <Money value={summary?.totalPaid ?? 0} />
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Paid and completed claims
          </p>
        </div>
      </div>

      <Card
        title="My recent requests"
        actions={
          <button
            className="-mr-2 flex min-h-11 items-center px-2 text-xs font-semibold text-primary hover:underline"
            onClick={() => router.push('/my-requests')}
          >
            View all
          </button>
        }
      >
        {!requests.length ? (
          <Empty
            title="No requests yet"
            hint="Create your first travel claim to get started."
          />
        ) : (
          <ul className="divide-y">
            {requests.slice(0, 6).map((r) => (
              <li key={r.requestId}>
                <button
                  onClick={() => router.push(`/requests/${r.requestId}`)}
                  className="flex w-full flex-col gap-3 py-3 text-left transition hover:bg-accent sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-semibold">
                        {r.requestId}
                      </span>
                      <StatusBadge status={r.status} />
                    </div>
                    <p className="mt-1 truncate text-sm text-muted-foreground">
                      {r.scope === 'inside' ? 'Inside city' : 'Outside city'} ·{' '}
                      {r.city || r.destination} · {r.fromDate}
                    </p>
                  </div>
                  <div className="w-full sm:w-56">
                    <ProgressBar status={r.status} />
                  </div>
                  <div className="text-sm font-semibold sm:w-32 sm:text-right">
                    <Money value={r.finalPayable} />
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
