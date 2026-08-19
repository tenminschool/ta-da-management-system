'use client';

import { useState } from 'react';
import { Button, Input, Textarea } from '@tenminuteschool/design-system';
import { api } from '@/lib/api';
import { Field, Modal, Notice } from '@/components/ui';

const ACTION_TITLE = {
  approve: 'Approve request',
  reject: 'Reject request',
  return: 'Return for correction',
  request_docs: 'Request more documents',
};

export function ActionModal({
  action,
  requestId,
  onClose,
  onDone,
  claimed,
  currency,
}: {
  action: keyof typeof ACTION_TITLE;
  requestId: string;
  onClose: () => void;
  onDone: () => void;
  /** What is payable as it stands, so an approver can pay something else. */
  claimed: number;
  currency: string;
}) {
  const [remarks, setRemarks] = useState('');
  const [amount, setAmount] = useState(claimed);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const changed = action === 'approve' && Number(amount) !== claimed;

  async function go() {
    setBusy(true);
    setError('');
    try {
      await api.act(
        requestId,
        action,
        remarks,
        action === 'approve' ? Number(amount) : undefined,
      );
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal title={ACTION_TITLE[action]} onClose={onClose}>
      <div className="space-y-4">
        {action === 'approve' && (
          <Field
            label={`Approve amount (${currency})`}
            hint={
              changed
                ? `Claimed ${currency} ${claimed} — you are approving ${currency} ${amount}. The claim itself is not changed; Finance sees both.`
                : 'Change this to approve less than was claimed.'
            }
          >
            <Input
              type="number"
              min={0}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
            />
          </Field>
        )}
        <Field
          label="Remarks"
          required={action !== 'approve' || changed}
          hint={
            changed
              ? 'Required — the employee, their line manager and Finance all see why the amount changed.'
              : action === 'approve'
                ? 'Optional — visible to the employee.'
                : 'Explain what the employee needs to do.'
          }
        >
          <Textarea
            className="min-h-24"
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
            variant={action === 'reject' ? 'destructive' : 'default'}
            onClick={go}
            disabled={busy || (changed && !remarks.trim())}
          >
            Confirm
          </Button>
        </div>
      </div>
    </Modal>
  );
}
