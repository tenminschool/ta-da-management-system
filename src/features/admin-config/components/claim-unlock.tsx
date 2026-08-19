'use client';

import { useEffect, useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { Button, Input } from '@tenminuteschool/design-system';
import { api, type EmployeeLite } from '@/lib/api';
import { Field, Card, Notice } from '@/components/ui';

export function ClaimUnlock() {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<EmployeeLite[]>([]);
  const [picked, setPicked] = useState<EmployeeLite | null>(null);
  const [from, setFrom] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!q.trim() || picked) {
      // Deferred a tick so this isn't a synchronous setState call inside
      // the effect body itself.
      queueMicrotask(() => setFound([]));
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const { employees } = await api.employees(q.trim());
        if (!cancelled) setFound(employees.slice(0, 6));
      } catch {
        /* the list is a convenience; typing an ID still works */
      }
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [q, picked]);

  async function save(date: string) {
    if (!picked) return;
    setBusy(true);
    setMessage('');
    setError('');
    try {
      await api.claimUnlock(picked.employeeId, date);
      setMessage(
        date
          ? `${picked.name} can file claims for travel from ${date} onward.`
          : `Late claims closed again for ${picked.name}.`,
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Unlock a late claim"
      subtitle="Claims must be filed within the window set by CLAIM_WINDOW_DAYS. Pick the earliest travel date one person may now file for."
    >
      <div className="grid gap-4 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
        <div className="relative">
          <Field label="Employee">
            {picked ? (
              <div className="flex items-center gap-2 rounded-xl border px-3 py-2.5">
                <span className="min-w-0 flex-1 truncate text-sm">
                  <span className="font-medium">{picked.name}</span>{' '}
                  <span className="text-muted-foreground">
                    {picked.employeeId}
                  </span>
                </span>
                <button
                  onClick={() => {
                    setPicked(null);
                    setQ('');
                    setMessage('');
                  }}
                  className="rounded-lg p-1 text-muted-foreground hover:bg-accent"
                  aria-label="Choose someone else"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ) : (
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search by name or employee ID"
              />
            )}
          </Field>
          {!picked && found.length > 0 && (
            <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-md">
              {found.map((e) => (
                <li key={e.employeeId}>
                  <button
                    onClick={() => {
                      setPicked(e);
                      setFound([]);
                    }}
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-accent"
                  >
                    <span className="font-medium">{e.name}</span>{' '}
                    <span className="text-xs text-muted-foreground">
                      {e.employeeId} · {e.department}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <Field label="Unlocked from">
          <Input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </Field>

        <div className="flex gap-2">
          <Button
            disabled={!picked || busy || !from}
            onClick={() => save(from)}
          >
            {busy && <Loader2 size={14} className="animate-spin" />} Unlock
          </Button>
          <Button
            variant="outline"
            disabled={!picked || busy}
            onClick={() => save('')}
          >
            Lock
          </Button>
        </div>
      </div>

      {message && (
        <div className="mt-4">
          <Notice tone="info" items={[message]} />
        </div>
      )}
      {error && (
        <div className="mt-4">
          <Notice tone="error" items={[error]} />
        </div>
      )}
    </Card>
  );
}
