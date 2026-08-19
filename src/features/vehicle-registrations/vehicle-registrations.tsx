'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { Button } from '@tenminuteschool/design-system';
import { api } from '@/lib/api';
import type { Policy, VehicleRegistration } from '@/shared/types';
import { cfgStr } from '@/shared/policy';
import { Card, Empty, Money, Notice, Spinner } from '@/components/ui';
import { DecideVehicleModal } from './components/decide-vehicle-modal';

const STATUS_STYLE: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700',
  approved: 'bg-emerald-50 text-emerald-700',
  rejected: 'bg-rose-50 text-rose-700',
};

/**
 * HR/Admin's queue of personal vehicles waiting for a rate to be approved.
 *
 * One row per employee — a resubmission after rejection overwrites their row
 * rather than adding another, so there is never more than one open decision
 * per person.
 */
export function VehicleRegistrationsPage({ policy }: { policy: Policy }) {
  const [tab, setTab] = useState<'pending' | 'all'>('pending');
  const [rows, setRows] = useState<VehicleRegistration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deciding, setDeciding] = useState<VehicleRegistration | null>(null);
  const currency = cfgStr(policy, 'CURRENCY', 'BDT');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows((await api.vehicles(tab)).vehicles);
      setError('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [tab]);
  useEffect(() => {
    // Deferred a tick so `load`'s own setLoading(true) isn't a synchronous
    // setState call inside the effect body itself.
    queueMicrotask(load);
  }, [load]);

  const rateFor = (v: VehicleRegistration) => {
    const fuel = policy.fuelTypes.find((f) => f.value === v.fuelType);
    return fuel && v.mileageKmPerLitre > 0
      ? fuel.pricePerLitre / v.mileageKmPerLitre
      : 0;
  };

  if (loading && !rows.length) return <Spinner />;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">Vehicle registrations</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Approve a vehicle before it can be claimed against — reimbursement is
          priced from its mileage and the current fuel price, not a flat band
          rate.
        </p>
      </div>

      <div className="flex gap-2">
        {(['pending', 'all'] as const).map((t) => (
          <Button
            key={t}
            size="sm"
            variant={tab === t ? 'default' : 'secondary'}
            className="capitalize"
            onClick={() => setTab(t)}
          >
            {t}
          </Button>
        ))}
      </div>

      {error && <Notice tone="error" items={[error]} />}

      <Card>
        {!rows.length ? (
          <Empty
            title={
              tab === 'pending'
                ? 'Nothing waiting on you'
                : 'No vehicles registered yet'
            }
            hint={
              tab === 'pending'
                ? 'New registrations appear here.'
                : 'They will appear here once someone registers a personal vehicle.'
            }
          />
        ) : (
          <>
            {/* Phones: a card per registration */}
            <ul className="space-y-2 md:hidden">
              {rows.map((v) => (
                <li key={v.employeeId} className="rounded-xl border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {v.employeeName}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {v.vehicleType} — {v.model} · {v.fuelType},{' '}
                        {v.mileageKmPerLitre} km/l
                      </span>
                      {v.imageLink && (
                        <a
                          href={v.imageLink}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-0.5 inline-block text-xs font-semibold text-primary hover:underline"
                        >
                          View photo
                        </a>
                      )}
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${STATUS_STYLE[v.status]}`}
                    >
                      {v.status}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                      <Money value={rateFor(v)} currency={currency} />
                      /km
                    </span>
                    {v.status === 'pending' && (
                      <Button
                        size="sm"
                        className="h-7 px-2.5 text-xs"
                        onClick={() => setDeciding(v)}
                      >
                        <Check size={13} /> Decide
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2.5 font-semibold">Employee</th>
                    <th className="px-3 py-2.5 font-semibold">Vehicle</th>
                    <th className="px-3 py-2.5 font-semibold">Fuel</th>
                    <th className="px-3 py-2.5 text-right font-semibold">
                      Mileage
                    </th>
                    <th className="px-3 py-2.5 text-right font-semibold">
                      Rate
                    </th>
                    <th className="px-3 py-2.5 font-semibold">Status</th>
                    <th className="px-3 py-2.5 font-semibold">Submitted</th>
                    <th className="px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((v) => (
                    <tr key={v.employeeId} className="hover:bg-accent">
                      <td className="px-3 py-3">
                        <span className="font-medium">{v.employeeName}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {v.employeeId}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        {v.vehicleType} — {v.model}
                        {v.imageLink && (
                          <a
                            href={v.imageLink}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-0.5 block text-xs font-semibold text-primary hover:underline"
                          >
                            View photo
                          </a>
                        )}
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {v.fuelType}
                      </td>
                      <td className="px-3 py-3 text-right text-muted-foreground">
                        {v.mileageKmPerLitre} km/l
                      </td>
                      <td className="px-3 py-3 text-right font-medium">
                        <Money value={rateFor(v)} currency={currency} />
                        /km
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${STATUS_STYLE[v.status]}`}
                        >
                          {v.status}
                        </span>
                        {v.status !== 'pending' && v.reviewNote && (
                          <span
                            className="mt-1 block max-w-[16rem] truncate text-xs text-muted-foreground"
                            title={v.reviewNote}
                          >
                            {v.reviewNote}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {v.submittedAt
                          ? new Date(v.submittedAt).toLocaleDateString()
                          : '—'}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {v.status === 'pending' && (
                          <Button
                            size="sm"
                            className="h-7 px-2.5 text-xs"
                            onClick={() => setDeciding(v)}
                          >
                            <Check size={13} /> Decide
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      {deciding && (
        <DecideVehicleModal
          vehicle={deciding}
          onClose={() => setDeciding(null)}
          onDone={() => {
            setDeciding(null);
            load();
          }}
        />
      )}
    </div>
  );
}
