'use client';

import { useEffect, useState } from 'react';
import { Trash2, Users } from 'lucide-react';
import { api } from '@/lib/api';
import type { TeamMember } from '@/shared/types';
import { Field, Notice, SearchInput } from '@/components/ui';

export function TeamPicker({
  members,
  onChange,
  excludeId,
}: {
  members: TeamMember[];
  onChange: (m: TeamMember[]) => void;
  excludeId: string;
}) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<TeamMember[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');

  const query = q.trim();

  /**
   * Debounced lookup, and the query is the ONLY dependency on purpose: adding a
   * member changes the parent's state, and if that re-ran this effect it would
   * cancel the in-flight search and blank the list. Nothing is fetched or shown
   * until the employee actually types.
   */
  useEffect(() => {
    if (!query) {
      // Deferred a tick so these aren't synchronous setState calls inside
      // the effect body itself.
      queueMicrotask(() => {
        setFound([]);
        setSearching(false);
        setError('');
      });
      return;
    }
    let cancelled = false;
    // Same deferral as above — these are the "search is now in flight"
    // flags, set synchronously the moment a debounced query starts.
    queueMicrotask(() => {
      setSearching(true);
      setError('');
    });
    const timer = window.setTimeout(async () => {
      try {
        const { employees } = await api.employees(query);
        if (cancelled) return;
        setFound(
          employees.map((e) => ({
            employeeId: e.employeeId,
            name: e.name,
            department: e.department,
            designation: e.designation,
            band: e.band,
            gender: e.gender,
            // Left blank rather than pulled from their record: the search
            // endpoint answers on every keystroke, and returning someone's
            // personal payout number just for typing their name is a wider leak
            // than this picker should cause. The claimant enters it by hand.
            bkashNumber: '',
            officeMealTaken: false,
            companyTransportAmount: 0,
            companyAccommodationAmount: 0,
          })),
        );
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  // Yourself and anyone already added are filtered out at render time, not
  // inside the fetch, so the list stays correct as members are added.
  const results = found.filter(
    (e) =>
      e.employeeId !== excludeId &&
      !members.some((m) => m.employeeId === e.employeeId),
  );

  return (
    <div className="space-y-3">
      <Field
        label="Add members"
        hint="Tap a name to add them. Search by employee ID or name — department, designation and band fill in automatically."
      >
        <SearchInput
          value={q}
          onChange={setQ}
          busy={searching}
          placeholder="Search by name or employee ID"
        />
      </Field>

      {error && <Notice tone="error" items={[error]} />}

      {/* Nothing is shown until the employee types — the roster is not a list
          to browse, it is a thing to search. */}
      {query && !error && !searching && results.length === 0 && (
        <p className="rounded-xl border bg-muted px-4 py-3 text-sm text-muted-foreground">
          Nobody matches &ldquo;{query}&rdquo;. Try the employee ID, or part of
          the name.
        </p>
      )}

      {query && results.length > 0 && (
        <ul className="max-h-56 overflow-y-auto rounded-xl border bg-popover">
          {results.map((r) => (
            <li key={r.employeeId}>
              <button
                type="button"
                onClick={() => {
                  onChange([...members, r]);
                  setQ('');
                }}
                className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-accent"
              >
                <span>
                  <span className="font-medium">{r.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {r.employeeId} · {r.designation}
                  </span>
                </span>
                <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                  Band {r.band}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {members.length > 0 && (
        <>
          {/* Phones: a card per member — five columns will not fit. */}
          <ul className="space-y-2 sm:hidden">
            {members.map((m) => (
              <li
                key={m.employeeId}
                className="flex items-start justify-between gap-2 rounded-xl border p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{m.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {m.employeeId} · Band {m.band}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {m.designation} · {m.department}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    onChange(
                      members.filter((x) => x.employeeId !== m.employeeId),
                    )
                  }
                  className="shrink-0 rounded-lg p-2 text-muted-foreground active:bg-destructive/10 active:text-destructive"
                  aria-label={`Remove ${m.name}`}
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-x-auto rounded-xl border sm:block">
            <table className="w-full text-sm">
              <thead className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-semibold">Employee</th>
                  <th className="px-3 py-2 font-semibold">Department</th>
                  <th className="px-3 py-2 font-semibold">Designation</th>
                  <th className="px-3 py-2 font-semibold">Band</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {members.map((m) => (
                  <tr key={m.employeeId}>
                    <td className="px-3 py-2">
                      <span className="font-medium">{m.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {m.employeeId}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {m.department}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {m.designation}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {m.band}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() =>
                          onChange(
                            members.filter(
                              (x) => x.employeeId !== m.employeeId,
                            ),
                          )
                        }
                        className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Users size={14} /> {members.length + 1} traveller(s) including you.
      </p>
    </div>
  );
}
