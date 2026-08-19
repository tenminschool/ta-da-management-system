'use client';

import { useState } from 'react';
import { Button, Input } from '@tenminuteschool/design-system';
import type { Leg, Policy, VehicleRegistration } from '@/shared/types';
import { money } from '@/shared/policy';
import { Field, Modal, Money, Notice, Spinner } from '@/components/ui';
import { VehicleRegisterForm } from '@/features/vehicle-register/components/vehicle-register-form';

export function PersonalVehicleLegModal({
  policy,
  currency,
  myVehicle,
  onVehicleChange,
  initial,
  onClose,
  onSave,
}: {
  policy: Policy;
  currency: string;
  myVehicle: VehicleRegistration | null | undefined;
  onVehicleChange: (v: VehicleRegistration) => void;
  initial: Leg;
  onClose: () => void;
  onSave: (patch: Partial<Leg>) => void;
}) {
  const [travelFrom, setTravelFrom] = useState(initial.travelFrom);
  const [travelTo, setTravelTo] = useState(initial.travelTo);
  const [km, setKm] = useState(0);
  const [editing, setEditing] = useState(false);

  if (myVehicle === undefined) {
    return (
      <Modal title="Personal vehicle" onClose={onClose}>
        <Spinner label="Checking your vehicle registration…" />
      </Modal>
    );
  }

  if (editing || !myVehicle || myVehicle.status !== 'approved') {
    const submitted = (v: VehicleRegistration) => {
      setEditing(false);
      onVehicleChange(v);
    };
    return (
      <Modal
        title={myVehicle ? 'Update your vehicle' : 'Register your vehicle'}
        onClose={onClose}
      >
        <div className="space-y-4">
          {myVehicle?.status === 'pending' && (
            <Notice
              tone="warn"
              items={[
                'Still waiting on HR or Admin to approve this — you can claim against it once they do.',
              ]}
            />
          )}
          {myVehicle?.status === 'rejected' && (
            <Notice
              tone="error"
              items={[
                `Not approved${myVehicle.reviewNote ? ` — ${myVehicle.reviewNote}` : ''}. Update the details and submit again.`,
              ]}
            />
          )}
          {!myVehicle && (
            <Notice
              tone="info"
              items={[
                'Register your vehicle once here and HR or Admin approval unlocks every personal-vehicle trip after that.',
              ]}
            />
          )}
          <VehicleRegisterForm
            policy={policy}
            initial={myVehicle}
            onSubmitted={submitted}
          />
        </div>
      </Modal>
    );
  }

  // Approved.
  const fuel = policy.fuelTypes.find((f) => f.value === myVehicle.fuelType);
  const rate =
    fuel && myVehicle.mileageKmPerLitre > 0
      ? fuel.pricePerLitre / myVehicle.mileageKmPerLitre
      : 0;
  const litres =
    myVehicle.mileageKmPerLitre > 0 ? km / myVehicle.mileageKmPerLitre : 0;
  const tripAmount = money(km * rate);

  return (
    <Modal title="Personal vehicle trip" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {myVehicle.vehicleType} — {myVehicle.model} · {myVehicle.fuelType},{' '}
          {myVehicle.mileageKmPerLitre} km/l.{' '}
          <button
            type="button"
            className="font-semibold text-primary hover:underline"
            onClick={() => setEditing(true)}
          >
            Update vehicle details
          </button>
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Travel from" required>
            <Input
              value={travelFrom}
              onChange={(e) => setTravelFrom(e.target.value)}
            />
          </Field>
          <Field label="Travel to" required>
            <Input
              value={travelTo}
              onChange={(e) => setTravelTo(e.target.value)}
            />
          </Field>
          <Field label="Total KM" required>
            <Input
              type="number"
              min={0}
              value={km || ''}
              onChange={(e) => setKm(Number(e.target.value))}
            />
          </Field>
        </div>
        {km > 0 && fuel && (
          <p className="rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">
            {km} km ÷ {myVehicle.mileageKmPerLitre} km/l = {litres.toFixed(2)} l
            of {myVehicle.fuelType} at {fuel.pricePerLitre} {currency}/l ={' '}
            <span className="font-semibold text-foreground">
              <Money value={tripAmount} currency={currency} />
            </span>
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!travelFrom.trim() || !travelTo.trim() || !(km > 0)}
            onClick={() =>
              onSave({
                travelFrom,
                travelTo,
                amount: tripAmount,
                note: `${km} km via ${myVehicle.vehicleType} (${myVehicle.model}).`,
              })
            }
          >
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}
