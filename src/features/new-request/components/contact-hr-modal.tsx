'use client';

import { useState } from 'react';
import { Button, Input, Textarea } from '@tenminuteschool/design-system';
import { api } from '@/lib/api';
import { Field, Modal, Notice } from '@/components/ui';

/**
 * "Contact HR" — raises a claim-window exception instead of leaving the
 * employee to go find someone. Administration sees the reason, decides, and
 * approving unlocks exactly this one trip's date — not an open window for
 * whatever gets filed after it.
 */
export function ContactHrModal({
  defaultDate,
  onClose,
  onDone,
}: {
  defaultDate: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [requestedFrom, setRequestedFrom] = useState(defaultDate);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setBusy(true);
    setError('');
    try {
      await api.requestUnlock(reason.trim(), requestedFrom);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Contact HR — ask for an older date" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Explain why this claim needs to be filed past the usual window.
          Administration reviews it and, if they approve, unlocks exactly this
          travel date for you — not the days after it.
        </p>
        <Field label="The travel date this claim is for">
          <Input
            type="date"
            value={requestedFrom}
            onChange={(e) => setRequestedFrom(e.target.value)}
          />
        </Field>
        <Field label="Why do you need this?" required>
          <Textarea
            className="min-h-24"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="What happened, and why the claim wasn't filed in time."
          />
        </Field>
        {error && <Notice tone="error" items={[error]} />}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !reason.trim()}>
            {busy ? 'Sending…' : 'Send to Administration'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
