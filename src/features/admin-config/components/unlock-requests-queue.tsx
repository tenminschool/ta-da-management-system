'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button, Input } from '@tenminuteschool/design-system';
import { api } from '@/lib/api';
import type { UnlockRequest } from '@/shared/types';
import { Card, Field, Notice, Spinner } from '@/components/ui';

/** "Contact HR" requests raised from the New Request form, waiting on a decision. */
export function UnlockRequestsQueue() {
  const [requests, setRequests] = useState<UnlockRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    return api
      .unlockRequests('pending')
      .then((r) => setRequests(r.requests))
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    // Deferred a tick so `load`'s own setLoading(true) isn't a synchronous
    // setState call inside the effect body itself.
    queueMicrotask(load);
  }, [load]);

  if (loading) return <Spinner />;
  // Nothing pending is the common case — no point taking up space for it.
  if (!requests.length && !error) return null;

  return (
    <Card
      title="Unlock requests"
      subtitle="Raised from the claim form's “Contact HR” button — approving one unlocks just that trip, not an open window like the tool below."
    >
      {error && <Notice tone="error" items={[error]} />}
      <div className="space-y-3">
        {requests.map((r) => (
          <UnlockRequestRow key={r.requestId} request={r} onDone={load} />
        ))}
      </div>
    </Card>
  );
}

function UnlockRequestRow({
  request,
  onDone,
}: {
  request: UnlockRequest;
  onDone: () => void;
}) {
  const [unlockFrom, setUnlockFrom] = useState(request.requestedFrom);
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function decide(action: 'approve' | 'reject') {
    if (!remarks.trim()) {
      setError('Add a remark explaining your decision.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.decideUnlock(
        request.requestId,
        action,
        remarks.trim(),
        action === 'approve' ? unlockFrom : undefined,
      );
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border p-3.5">
      <p className="text-sm font-semibold">
        {request.employeeName}{' '}
        <span className="font-normal text-muted-foreground">
          {request.employeeId} · {request.department}
        </span>
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Asked for {request.requestedFrom || '—'} · submitted{' '}
        {new Date(request.submittedAt).toLocaleString()}
      </p>
      <p className="mt-2 text-sm">{request.reason}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-[10rem_1fr]">
        <Field
          label="Unlock exactly this date"
          hint="Only this one trip — not an open window for anything filed after it."
        >
          <Input
            type="date"
            value={unlockFrom}
            onChange={(e) => setUnlockFrom(e.target.value)}
          />
        </Field>
        <Field label="Remarks">
          <Input
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="Why you're approving or declining this."
          />
        </Field>
      </div>
      {error && (
        <div className="mt-2">
          <Notice tone="error" items={[error]} />
        </div>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <Button
          variant="destructive"
          disabled={busy}
          onClick={() => decide('reject')}
        >
          Reject
        </Button>
        <Button
          disabled={busy || !unlockFrom}
          onClick={() => decide('approve')}
        >
          {busy && <Loader2 size={14} className="animate-spin" />} Approve &amp;
          unlock
        </Button>
      </div>
    </div>
  );
}
