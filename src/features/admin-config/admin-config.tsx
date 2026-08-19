'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { Button, Input } from '@tenminuteschool/design-system';
import { api } from '@/lib/api';
import { Card, Notice, Spinner } from '@/components/ui';
import { ClaimUnlock } from './components/claim-unlock';
import { InsideCityBlockManager } from './components/inside-city-block-manager';
import { UnlockRequestsQueue } from './components/unlock-requests-queue';

const DESCRIPTIONS: Record<string, string> = {
  Config:
    'Rates, limits and thresholds. Change a value here and every calculation follows it immediately.',
  BandPolicy:
    'Per-band transport lists (male / female), outside-city weekday & weekend rates, accommodation limit, flight and car-pool eligibility.',
  Lists:
    'Every dropdown in one place, keyed by ListName — City (Extra1 = Inside/Outside), TransportMode (Extra1 = scope, Extra2 = needs receipt), WorkedAt, DualWorkstation, PaymentMethod, DocumentType, and ApprovalStage (Extra1 = step order, Extra2 = role).',
  Employees:
    'People, bands, line managers and roles. The roles column is one of user, admin, hr or finance — everyone can raise a claim regardless, and being a line manager comes from line_manager_id, not from here.',
};

export function AdminConfigPage() {
  const [tabs, setTabs] = useState<string[]>([]);
  const [headers, setHeaders] = useState<Record<string, string[]>>({});
  const [data, setData] = useState<Record<string, Record<string, string>[]>>(
    {},
  );
  const [active, setActive] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    return api
      .adminTabs()
      .then((r) => {
        setTabs(r.tabs);
        setHeaders(r.headers);
        setData(r.data);
        setActive(r.tabs[0]);
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    // Deferred a tick so `load`'s own setLoading(true) isn't a synchronous
    // setState call inside the effect body itself.
    queueMicrotask(load);
  }, [load]);

  const cols = useMemo(
    () => (active ? headers[active] || [] : []),
    [active, headers],
  );
  const rows = active ? data[active] || [] : [];

  function edit(rowIdx: number, col: string, value: string) {
    setData((d) => ({
      ...d,
      [active]: (d[active] || []).map((r, i) =>
        i === rowIdx ? { ...r, [col]: value } : r,
      ),
    }));
  }

  async function save() {
    setSaving(true);
    setMessage('');
    setError('');
    try {
      // `_row` is bookkeeping from the read layer and is not a real column.
      const clean = rows.map((r) =>
        Object.fromEntries(cols.map((c) => [c, r[c] ?? ''])),
      );
      await api.saveTab(active, clean);
      setMessage(`${active} saved — the new policy is live.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Spinner />;
  if (error && !tabs.length) return <Notice tone="error" items={[error]} />;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold sm:text-xl">Admin configuration</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every policy value lives here and in the Google Sheet — changing a
          rate, a band rule or the approval chain never needs a code change.
        </p>
      </div>

      <UnlockRequestsQueue />
      <ClaimUnlock />
      <InsideCityBlockManager />

      <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => {
              setActive(t);
              setMessage('');
              setError('');
            }}
            className={`shrink-0 rounded-lg px-3 py-2 text-xs font-semibold transition ${
              active === t
                ? 'bg-primary text-primary-foreground'
                : 'bg-card text-muted-foreground ring-1 ring-border hover:bg-accent'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <Card
        title={active}
        subtitle={DESCRIPTIONS[active]}
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setData((d) => ({
                  ...d,
                  [active]: [
                    ...(d[active] || []),
                    Object.fromEntries(cols.map((c) => [c, ''])),
                  ],
                }))
              }
            >
              <Plus size={14} /> Add row
            </Button>
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Save size={14} />
              )}{' '}
              Save
            </Button>
          </div>
        }
      >
        {message && (
          <div className="mb-4">
            <Notice tone="info" items={[message]} />
          </div>
        )}
        {error && (
          <div className="mb-4">
            <Notice tone="error" items={[error]} />
          </div>
        )}

        {/* Phones: a card per row with labelled fields. A 13-column table on a
            360px screen is unusable, however much you let it scroll. */}
        <div className="space-y-3 md:hidden">
          {rows.map((row, i) => (
            <div key={i} className="rounded-xl border p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="truncate text-xs font-bold">
                  {row[cols[0]] || `Row ${i + 1}`}
                </span>
                <button
                  onClick={() =>
                    setData((d) => ({
                      ...d,
                      [active]: (d[active] || []).filter((_, idx) => idx !== i),
                    }))
                  }
                  className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground active:bg-destructive/10 active:text-destructive"
                  aria-label="Delete row"
                >
                  <Trash2 size={15} />
                </button>
              </div>
              <div className="space-y-2">
                {cols.map((c) => (
                  <label key={c} className="block">
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {c}
                    </span>
                    <Input
                      value={row[c] ?? ''}
                      onChange={(e) => edit(i, c, e.target.value)}
                    />
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="-mx-1 hidden overflow-x-auto px-1 md:block">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                {cols.map((c) => (
                  <th
                    key={c}
                    className="whitespace-nowrap px-2 py-2 font-semibold"
                  >
                    {c}
                  </th>
                ))}
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row, i) => (
                <tr key={i}>
                  {cols.map((c) => (
                    <td key={c} className="px-1 py-1">
                      <Input
                        className="px-2 py-1.5 text-xs"
                        value={row[c] ?? ''}
                        onChange={(e) => edit(i, c, e.target.value)}
                      />
                    </td>
                  ))}
                  <td className="px-1 py-1">
                    <button
                      onClick={() =>
                        setData((d) => ({
                          ...d,
                          [active]: (d[active] || []).filter(
                            (_, idx) => idx !== i,
                          ),
                        }))
                      }
                      className="flex size-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      aria-label="Delete row"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!rows.length && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No rows. Add one to get started.
          </p>
        )}
      </Card>
    </div>
  );
}
