'use client';

import { useState } from 'react';
import { Banknote } from 'lucide-react';
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@tenminuteschool/design-system';
import { api } from '@/lib/api';
import { todayISO } from '@/shared/policy';
import { Field, Modal, Notice } from '@/components/ui';

export function PaymentModal({
  requestId,
  amount,
  bkashNumber,
  methods,
  currency,
  onClose,
  onDone,
  needsRemark = false,
}: {
  requestId: string;
  amount: number;
  /** Re-paying after a dispute: the employee is owed an explanation. */
  needsRemark?: boolean;
  bkashNumber: string;
  methods: string[];
  currency: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [paymentMode, setPaymentMode] = useState(methods[0] || 'Bank');
  const [transactionId, setTransactionId] = useState('');
  const [paid, setPaid] = useState(amount);
  const [paymentDate, setPaymentDate] = useState(todayISO());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function go() {
    setBusy(true);
    setError('');
    try {
      await api.pay(requestId, {
        paymentMode,
        transactionId,
        amount: paid,
        paymentDate,
        note,
      });
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal title="Record payment" onClose={onClose}>
      <div className="space-y-4">
        {bkashNumber && (
          <div className="rounded-xl bg-muted px-4 py-3 text-sm">
            <span className="text-muted-foreground">
              Employee&apos;s bKash number:{' '}
            </span>
            <span className="font-mono font-semibold">{bkashNumber}</span>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Payment mode" required>
            <Select value={paymentMode} onValueChange={setPaymentMode}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {methods.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={`Amount (${currency})`} required>
            <Input
              type="number"
              value={paid}
              onChange={(e) => setPaid(Number(e.target.value))}
            />
          </Field>
          <Field label="Transaction ID" required>
            <Input
              value={transactionId}
              onChange={(e) => setTransactionId(e.target.value)}
            />
          </Field>
          <Field label="Payment date" required>
            <Input
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
            />
          </Field>
        </div>
        <Field
          label={needsRemark ? 'What happened to the first payment?' : 'Note'}
          required={needsRemark}
          hint={
            needsRemark
              ? 'The employee sees this — they said the money never arrived.'
              : undefined
          }
        >
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {error && <Notice tone="error" items={[error]} />}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={go} disabled={busy || (needsRemark && !note.trim())}>
            <Banknote size={16} /> Mark paid
          </Button>
        </div>
      </div>
    </Modal>
  );
}
