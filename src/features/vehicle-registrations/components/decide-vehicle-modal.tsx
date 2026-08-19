'use client';

import { useState } from 'react';
import { Button, Textarea } from '@tenminuteschool/design-system';
import { api } from '@/lib/api';
import type { VehicleRegistration } from '@/shared/types';
import { Field, Modal, Notice } from '@/components/ui';

export function DecideVehicleModal({
  vehicle,
  onClose,
  onDone,
}: {
  vehicle: VehicleRegistration;
  onClose: () => void;
  onDone: () => void;
}) {
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function decide(action: 'approve' | 'reject') {
    if (action === 'reject' && !remarks.trim()) {
      setError('Add a remark explaining why this vehicle was not approved.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.decideVehicle(vehicle.employeeId, action, remarks.trim());
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal title={`${vehicle.employeeName}'s vehicle`} onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-xl bg-muted px-4 py-3 text-sm">
          <p className="font-medium">
            {vehicle.vehicleType} — {vehicle.model}
          </p>
          <p className="mt-0.5 text-muted-foreground">
            {vehicle.fuelType} · {vehicle.mileageKmPerLitre} km per litre
          </p>
          {vehicle.imageLink ? (
            <a
              href={vehicle.imageLink}
              target="_blank"
              rel="noreferrer"
              className="mt-1.5 inline-block text-xs font-semibold text-primary hover:underline"
            >
              View vehicle photo (check the number plate)
            </a>
          ) : (
            <p className="mt-1.5 text-xs text-amber-600">No photo uploaded.</p>
          )}
        </div>
        <Field
          label="Remarks"
          hint="Required if you are rejecting this — the employee sees it."
        >
          <Textarea
            className="min-h-20"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
          />
        </Field>
        {error && <Notice tone="error" items={[error]} />}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => decide('reject')}
            disabled={busy}
          >
            Reject
          </Button>
          <Button onClick={() => decide('approve')} disabled={busy}>
            Approve
          </Button>
        </div>
      </div>
    </Modal>
  );
}
