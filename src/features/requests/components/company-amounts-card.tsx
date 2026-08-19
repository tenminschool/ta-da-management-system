'use client';

import { useState } from 'react';
import { Button, Input } from '@tenminuteschool/design-system';
import { api, type RequestDetail as Detail } from '@/lib/api';
import { Card, Field, Money, Notice } from '@/components/ui';

/** Company Arrangement trips skip employee-entered transport/hotel figures — HR/Admin logs what it actually cost, for reporting only. */
export function CompanyAmountsCard({
  r,
  currency,
  canEdit,
  onSaved,
}: {
  r: Detail['request'];
  currency: string;
  canEdit: boolean;
  onSaved: (updated: Detail['request']) => void;
}) {
  const isTeam = r.travelType === 'team' && r.teamMembers.length > 0;
  // The requester isn't in teamMembers, so they're stitched in as row zero —
  // one line per traveller, since costs genuinely differ within a trip (one
  // person staying an extra night, say).
  const baseline = [
    {
      employeeId: r.employeeId,
      name: r.employeeName,
      transport: r.companyTransportAmount || 0,
      accommodation: r.companyAccommodationAmount || 0,
    },
    ...r.teamMembers.map((m) => ({
      employeeId: m.employeeId,
      name: m.name || m.employeeId,
      transport: m.companyTransportAmount || 0,
      accommodation: m.companyAccommodationAmount || 0,
    })),
  ];
  const [rows, setRows] = useState(baseline);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const changed = rows.some(
    (row, i) =>
      row.transport !== baseline[i].transport ||
      row.accommodation !== baseline[i].accommodation,
  );
  const update = (
    i: number,
    patch: Partial<{ transport: number; accommodation: number }>,
  ) =>
    setRows((prev) =>
      prev.map((row, idx) => (idx === i ? { ...row, ...patch } : row)),
    );

  async function save() {
    setBusy(true);
    setError('');
    try {
      const entries = rows.map((row) => ({
        employeeId: row.employeeId,
        companyTransportAmount: row.transport,
        companyAccommodationAmount: row.accommodation,
      }));
      const { request } = await api.saveCompanyAmounts(r.requestId, entries);
      onSaved(request);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Company-arranged amounts"
      subtitle="Booked and paid by the company directly — for reporting only, this does not change what's payable to anyone."
    >
      {canEdit ? (
        <>
          {isTeam ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-3 font-semibold">Traveller</th>
                    <th className="py-2 pr-3 font-semibold">
                      Transportation ({currency})
                    </th>
                    <th className="py-2 font-semibold">
                      Accommodation ({currency})
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((row, i) => (
                    <tr key={row.employeeId || i}>
                      <td className="py-2 pr-3">
                        {row.name}
                        {row.employeeId === r.employeeId ? ' (requester)' : ''}
                      </td>
                      <td className="py-2 pr-3">
                        <Input
                          type="number"
                          min={0}
                          value={row.transport || ''}
                          onChange={(e) =>
                            update(i, { transport: Number(e.target.value) })
                          }
                        />
                      </td>
                      <td className="py-2">
                        <Input
                          type="number"
                          min={0}
                          value={row.accommodation || ''}
                          onChange={(e) =>
                            update(i, { accommodation: Number(e.target.value) })
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={`Transportation (${currency})`}>
                <Input
                  type="number"
                  min={0}
                  value={rows[0].transport || ''}
                  onChange={(e) =>
                    update(0, { transport: Number(e.target.value) })
                  }
                />
              </Field>
              <Field label={`Accommodation (${currency})`}>
                <Input
                  type="number"
                  min={0}
                  value={rows[0].accommodation || ''}
                  onChange={(e) =>
                    update(0, { accommodation: Number(e.target.value) })
                  }
                />
              </Field>
            </div>
          )}
          {r.companyAmountsBy && (
            <p className="mt-2 text-xs text-muted-foreground">
              Last recorded by {r.companyAmountsBy.replace(/<.*>/, '').trim()}
              {r.companyAmountsAt
                ? ` on ${new Date(r.companyAmountsAt).toLocaleDateString()}`
                : ''}
              .
            </p>
          )}
          {error && (
            <div className="mt-2">
              <Notice tone="error" items={[error]} />
            </div>
          )}
          <div className="mt-3 flex justify-end">
            <Button onClick={save} disabled={busy || !changed}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </>
      ) : isTeam ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="py-2 pr-3 font-semibold">Traveller</th>
                <th className="py-2 pr-3 font-semibold">Transportation</th>
                <th className="py-2 font-semibold">Accommodation</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {baseline.map((row, i) => (
                <tr key={row.employeeId || i}>
                  <td className="py-2 pr-3">
                    {row.name}
                    {row.employeeId === r.employeeId ? ' (requester)' : ''}
                  </td>
                  <td className="py-2 pr-3">
                    {row.transport > 0 ? (
                      <Money value={row.transport} currency={currency} />
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="py-2">
                    {row.accommodation > 0 ? (
                      <Money value={row.accommodation} currency={currency} />
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Transportation</span>
            <span className="font-medium">
              {r.companyTransportAmount > 0 ? (
                <Money value={r.companyTransportAmount} currency={currency} />
              ) : (
                'Not recorded yet'
              )}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Accommodation</span>
            <span className="font-medium">
              {r.companyAccommodationAmount > 0 ? (
                <Money
                  value={r.companyAccommodationAmount}
                  currency={currency}
                />
              ) : (
                'Not recorded yet'
              )}
            </span>
          </div>
        </div>
      )}
    </Card>
  );
}
