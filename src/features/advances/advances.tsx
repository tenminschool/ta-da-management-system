'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, HandCoins, X } from 'lucide-react';
import { Button } from '@tenminuteschool/design-system';
import { api, type AdvanceStep } from '@/lib/api';
import type { Policy, RequestRecord } from '@/shared/types';
import { cfgNum, cfgStr } from '@/shared/policy';
import { Card, Empty, Money, Spinner } from '@/components/ui';
import { AdvanceModal } from '@/features/requests/components/advance-modal';

type Row = RequestRecord & { myStep: AdvanceStep | null };

export function AdvancesPage({
  policy,
  scope,
}: {
  policy: Policy;
  /** "mine" = my own advances; "desk" = advances I review for other people. */
  scope: 'mine' | 'desk';
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<{
    row: Row;
    mode: 'approve' | 'settle' | 'reject';
  } | null>(null);
  const currency = cfgStr(policy, 'CURRENCY', 'BDT');
  const limit = cfgNum(policy, 'ADVANCE_AUTO_LIMIT', 10000);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows((await api.advances(scope)).requests);
    } finally {
      setLoading(false);
    }
  }, [scope]);
  useEffect(() => {
    // Deferred a tick so `load`'s own setLoading(true) isn't a synchronous
    // setState call inside the effect body itself.
    queueMicrotask(load);
  }, [load]);

  /**
   * What still has to happen on this advance, and whether this person is the
   * one who does it. The server already worked that out — `myStep` is null when
   * the next step belongs to somebody else.
   */
  function nextStepFor(r: Row): {
    label: string;
    mode: 'approve' | 'settle' | null;
  } {
    if (r.settledAt || r.advanceStatus === 'rejected')
      return { label: '', mode: null };
    const waiting =
      r.advanceStatus === 'approved'
        ? 'Settlement'
        : r.advanceStatus === 'awaiting_dept_head'
          ? 'Department Head approval'
          : r.advanceStatus === 'manager_approved'
            ? 'HR approval'
            : 'Line Manager approval';
    if (!r.myStep) return { label: waiting, mode: null };
    return {
      label: r.myStep.label,
      mode: r.myStep.action === 'settle' ? 'settle' : 'approve',
    };
  }

  if (loading) return <Spinner />;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">
          {scope === 'mine' ? 'My travel advance' : 'Advance approvals'}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {scope === 'mine'
            ? `Advances you have requested. Available for outside-city trips longer than ${cfgNum(policy, 'ADVANCE_MIN_TRIP_DAYS', 3)} days, settled within ${cfgNum(policy, 'ADVANCE_SETTLEMENT_DAYS', 3)} working days of the trip ending.`
            : `Other people's advances in your chain. Line Manager and HR approve; above ${currency} ${limit} the Department Head approves too.`}
        </p>
      </div>

      <Card>
        {!rows.length ? (
          <Empty
            title={
              scope === 'mine'
                ? 'You have no advance requests'
                : 'No advances to review'
            }
            hint={
              scope === 'mine'
                ? 'Ask for an advance while creating an eligible outside-city claim.'
                : 'Advances appear here once an eligible trip requests one.'
            }
          />
        ) : (
          <>
            {/* Phones: card per advance */}
            <ul className="space-y-2 md:hidden">
              {rows.map((r) => {
                const step = nextStepFor(r);
                return (
                  <li key={r.requestId} className="rounded-xl border p-3">
                    <button
                      onClick={() => router.push(`/requests/${r.requestId}`)}
                      className="w-full text-left"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <span className="font-mono text-xs font-semibold text-primary">
                            {r.requestId}
                          </span>
                          <span className="mt-0.5 block truncate text-sm font-medium">
                            {r.employeeName}
                          </span>
                        </div>
                        <span className="shrink-0 text-sm font-bold">
                          <Money
                            value={r.advanceRequested}
                            currency={currency}
                          />
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold capitalize text-muted-foreground">
                          {(r.advanceStatus || 'pending').replace(/_/g, ' ')}
                        </span>
                        {r.settlementDueDate && (
                          <span className="text-xs text-muted-foreground">
                            due {r.settlementDueDate}
                          </span>
                        )}
                      </div>
                    </button>
                    {step.mode && (
                      <div className="mt-3 flex gap-2">
                        <Button
                          size="sm"
                          className="h-7 flex-1 text-xs"
                          onClick={() =>
                            setActing({ row: r, mode: step.mode! })
                          }
                        >
                          {step.mode === 'settle' ? (
                            <HandCoins size={13} />
                          ) : (
                            <Check size={13} />
                          )}
                          {step.mode === 'settle' ? 'Settle' : 'Approve'}
                        </Button>
                        {step.mode === 'approve' && (
                          <Button
                            size="sm"
                            variant="destructive"
                            className="h-7 px-3 text-xs"
                            onClick={() =>
                              setActing({ row: r, mode: 'reject' })
                            }
                          >
                            <X size={13} /> Reject
                          </Button>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>

            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2.5 font-semibold">Request</th>
                    <th className="px-3 py-2.5 font-semibold">Employee</th>
                    <th className="px-3 py-2.5 text-right font-semibold">
                      Requested
                    </th>
                    <th className="px-3 py-2.5 text-right font-semibold">
                      Approved
                    </th>
                    <th className="px-3 py-2.5 font-semibold">Status</th>
                    <th className="px-3 py-2.5 font-semibold">
                      Settlement due
                    </th>
                    <th className="px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((r) => {
                    const step = nextStepFor(r);
                    return (
                      <tr key={r.requestId} className="hover:bg-accent">
                        <td className="px-3 py-3">
                          <button
                            className="font-mono text-xs font-semibold text-primary hover:underline"
                            onClick={() =>
                              router.push(`/requests/${r.requestId}`)
                            }
                          >
                            {r.requestId}
                          </button>
                        </td>
                        <td className="px-3 py-3">{r.employeeName}</td>
                        <td className="px-3 py-3 text-right font-medium">
                          <Money
                            value={r.advanceRequested}
                            currency={currency}
                          />
                        </td>
                        <td className="px-3 py-3 text-right text-muted-foreground">
                          {r.advanceApproved ? (
                            <Money
                              value={r.advanceApproved}
                              currency={currency}
                            />
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold capitalize text-muted-foreground">
                            {(r.advanceStatus || 'pending').replace(/_/g, ' ')}
                          </span>
                          {step.label && (
                            <span className="mt-1 block text-xs text-muted-foreground">
                              Next: {step.label}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-muted-foreground">
                          {r.settlementDueDate || '—'}
                        </td>
                        <td className="px-3 py-3 text-right">
                          {step.mode && (
                            <div className="flex justify-end gap-1">
                              <Button
                                size="sm"
                                className="h-7 px-2.5 text-xs"
                                onClick={() =>
                                  setActing({ row: r, mode: step.mode! })
                                }
                              >
                                {step.mode === 'settle' ? (
                                  <HandCoins size={13} />
                                ) : (
                                  <Check size={13} />
                                )}
                                {step.mode === 'settle' ? 'Settle' : 'Approve'}
                              </Button>
                              {step.mode === 'approve' && (
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  className="h-7 px-2.5 text-xs"
                                  onClick={() =>
                                    setActing({ row: r, mode: 'reject' })
                                  }
                                >
                                  <X size={13} />
                                </Button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      {acting && (
        <AdvanceModal
          requestId={acting.row.requestId}
          mode={acting.mode}
          currency={currency}
          action={acting.row.myStep?.action || 'hr_approve'}
          requested={acting.row.advanceRequested}
          approved={acting.row.advanceApproved}
          limit={limit}
          onClose={() => setActing(null)}
          onDone={() => {
            setActing(null);
            load();
          }}
        />
      )}
    </div>
  );
}
