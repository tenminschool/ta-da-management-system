'use client';

import { useState } from 'react';
import { Button, Input } from '@tenminuteschool/design-system';
import type { Leg, Policy } from '@/shared/types';
import { cfgNum } from '@/shared/policy';
import { Field, Modal, Notice } from '@/components/ui';

export function RentACarLegModal({
  policy,
  currency,
  initial,
  headcount,
  onClose,
  onSave,
}: {
  policy: Policy;
  currency: string;
  initial: Leg;
  headcount: number;
  onClose: () => void;
  onSave: (patch: Partial<Leg>, headcount: number) => void;
}) {
  const [amount, setAmount] = useState(initial.amount || 0);
  const [head, setHead] = useState(headcount || 0);
  const limit = cfgNum(policy, 'RENT_A_CAR_LIMIT', 6000);
  const minHead = cfgNum(policy, 'RENT_A_CAR_MIN_HEADCOUNT', 3);

  return (
    <Modal title="Rent-a-car" onClose={onClose}>
      <div className="space-y-4">
        <Notice
          tone="warn"
          items={[
            `Cannot exceed ${currency} ${limit} one way, and needs at least ${minHead} employees pooling together.`,
          ]}
        />
        <Field label={`Amount (${currency})`} required>
          <Input
            type="number"
            min={0}
            max={limit}
            value={amount || ''}
            onChange={(e) => setAmount(Math.min(Number(e.target.value), limit))}
          />
        </Field>
        <Field label="Employees sharing the car" required>
          <Input
            type="number"
            min={0}
            value={head || ''}
            onChange={(e) => setHead(Number(e.target.value))}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!(amount > 0) || !(head >= minHead)}
            onClick={() =>
              onSave(
                { amount, note: `Rent-a-car pooled across ${head} employees.` },
                head,
              )
            }
          >
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}
