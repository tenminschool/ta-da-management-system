'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { Button, Input } from '@tenminuteschool/design-system';
import { api } from '@/lib/api';
import type { InsideCityBlockEntry } from '@/shared/types';
import { Card, Notice, Spinner } from '@/components/ui';

export function InsideCityBlockManager() {
  const [entries, setEntries] = useState<InsideCityBlockEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newNote, setNewNote] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');
  const [editing, setEditing] = useState<string>(''); // original email being edited, if any
  const [editEmail, setEditEmail] = useState('');
  const [editNote, setEditNote] = useState('');
  const [busyEmail, setBusyEmail] = useState('');
  const [rowError, setRowError] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    setLoading(true);
    return api
      .insideCityBlock()
      .then((r) => setEntries(r.entries))
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    // Deferred a tick so `load`'s own setLoading(true) isn't a synchronous
    // setState call inside the effect body itself.
    queueMicrotask(load);
  }, [load]);

  async function add() {
    setAdding(true);
    setAddError('');
    try {
      await api.addInsideCityBlock(newEmail.trim(), newNote.trim());
      setNewEmail('');
      setNewNote('');
      load();
    } catch (err) {
      setAddError((err as Error).message);
    } finally {
      setAdding(false);
    }
  }

  function startEdit(e: InsideCityBlockEntry) {
    setEditing(e.email);
    setEditEmail(e.email);
    setEditNote(e.note);
  }

  async function saveEdit(originalEmail: string) {
    setBusyEmail(originalEmail);
    setRowError((r) => ({ ...r, [originalEmail]: '' }));
    try {
      await api.updateInsideCityBlock(
        originalEmail,
        editEmail.trim(),
        editNote.trim(),
      );
      setEditing('');
      load();
    } catch (err) {
      setRowError((r) => ({ ...r, [originalEmail]: (err as Error).message }));
    } finally {
      setBusyEmail('');
    }
  }

  async function remove(email: string) {
    setBusyEmail(email);
    setRowError((r) => ({ ...r, [email]: '' }));
    try {
      await api.removeInsideCityBlock(email);
      load();
    } catch (err) {
      setRowError((r) => ({ ...r, [email]: (err as Error).message }));
    } finally {
      setBusyEmail('');
    }
  }

  return (
    <Card
      title="Inside-city restrictions"
      subtitle="Someone here can still see every claim as usual and still raise an outside-city one — just not a new inside-city request."
    >
      {loading ? (
        <Spinner />
      ) : (
        <>
          {entries.length > 0 && (
            <ul className="mb-4 divide-y text-sm">
              {entries.map((e) => (
                <li key={e.email} className="py-2.5">
                  {editing === e.email ? (
                    <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                      <Input
                        value={editEmail}
                        onChange={(ev) => setEditEmail(ev.target.value)}
                      />
                      <Input
                        placeholder="Note (optional)"
                        value={editNote}
                        onChange={(ev) => setEditNote(ev.target.value)}
                      />
                      <div className="flex gap-2">
                        <Button
                          className="shrink-0"
                          disabled={busyEmail === e.email || !editEmail.trim()}
                          onClick={() => saveEdit(e.email)}
                        >
                          {busyEmail === e.email ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Save size={14} />
                          )}
                        </Button>
                        <Button
                          variant="outline"
                          className="shrink-0"
                          onClick={() => setEditing('')}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="min-w-0">
                        <span className="font-medium">{e.email}</span>
                        {e.note && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {e.note}
                          </span>
                        )}
                        <span className="ml-2 block text-xs text-muted-foreground sm:inline">
                          Added by {e.addedBy.replace(/<.*>/, '').trim()}
                        </span>
                      </span>
                      <div className="flex shrink-0 gap-1">
                        <button
                          className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent"
                          onClick={() => startEdit(e)}
                          aria-label={`Edit ${e.email}`}
                        >
                          <Save size={14} />
                        </button>
                        <button
                          className="rounded-lg p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          disabled={busyEmail === e.email}
                          onClick={() => remove(e.email)}
                          aria-label={`Remove ${e.email}`}
                        >
                          {busyEmail === e.email ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Trash2 size={14} />
                          )}
                        </button>
                      </div>
                    </div>
                  )}
                  {rowError[e.email] && (
                    <p className="mt-1 text-xs text-destructive">
                      {rowError[e.email]}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-start">
            <Input
              type="email"
              placeholder="name@10minuteschool.com"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
            />
            <Input
              placeholder="Note (optional)"
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
            />
            <Button
              className="shrink-0"
              disabled={adding || !newEmail.trim()}
              onClick={add}
            >
              {adding ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Plus size={14} />
              )}{' '}
              Restrict
            </Button>
          </div>
          {addError && (
            <div className="mt-3">
              <Notice tone="error" items={[addError]} />
            </div>
          )}
          {error && (
            <div className="mt-3">
              <Notice tone="error" items={[error]} />
            </div>
          )}
        </>
      )}
    </Card>
  );
}
