'use client';

import { useState } from 'react';
import { Button, Input, Textarea } from '@tenminuteschool/design-system';
import { api } from '@/lib/api';
import { Field, Modal, Notice } from '@/components/ui';

/**
 * Shared between the Advances list and the request detail page — both
 * surfaces let someone act on the same advance, so the same modal (and the
 * same `/requests/:id/advance` call) handles it either way.
 */
export function AdvanceModal({
  requestId,
  mode,
  action,
  currency,
  requested,
  approved,
  limit,
  onClose,
  onDone,
}: {
  requestId: string;
  mode: 'approve' | 'settle' | 'reject';
  /** The exact API action the server said this person may take. */
  action: string;
  currency: string;
  requested: number;
  approved: number;
  limit: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState(approved || requested);
  const [settled, setSettled] = useState(approved || requested);
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function go() {
    setBusy(true);
    setError('');
    try {
      await api.advanceAction(requestId, {
        action: mode === 'reject' ? 'reject' : action,
        amount,
        settledAmount: settled,
        remarks,
      });
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const title =
    mode === 'settle'
      ? 'Record advance settlement'
      : mode === 'reject'
        ? 'Reject advance'
        : 'Approve advance';
  return (
    <Modal title={`${title} — ${requestId}`} onClose={onClose}>
      <div className="space-y-4">
        {mode === 'approve' && (
          <>
            <Field label={`Approved amount (${currency})`} required>
              <Input
                type="number"
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
              />
            </Field>
            {requested > limit && action !== 'dept_head_approve' && (
              <Notice
                tone="warn"
                items={[
                  `Above ${currency} ${limit}, this still needs Department Head approval after yours.`,
                ]}
              />
            )}
          </>
        )}
        {mode === 'settle' && (
          <Field
            label={`Settled amount (${currency})`}
            required
            hint="What the employee actually returned or adjusted."
          >
            <Input
              type="number"
              value={settled}
              onChange={(e) => setSettled(Number(e.target.value))}
            />
          </Field>
        )}
        <Field label="Remarks" required={mode === 'reject'}>
          <Textarea
            className="min-h-20"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
          />
        </Field>
        {error && <Notice tone="error" items={[error]} />}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={mode === 'reject' ? 'destructive' : 'default'}
            onClick={go}
            disabled={busy}
          >
            Confirm
          </Button>
        </div>
      </div>
    </Modal>
  );
}
