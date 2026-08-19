'use client';

import { useEffect, useState } from 'react';
import { Button } from '@tenminuteschool/design-system';
import { api } from '@/lib/api';
import type { Policy, VehicleRegistration } from '@/shared/types';
import { Card, Notice, Spinner } from '@/components/ui';
import { VehicleRegisterForm } from './components/vehicle-register-form';

/**
 * The standalone "Register your Vehicle" page — reachable from the main
 * nav, not just from a Personal Vehicle claim, so someone can get approved
 * ahead of time and have their vehicle auto-selected the first time they
 * actually file a claim.
 */
export function VehicleRegisterPage({ policy }: { policy: Policy }) {
  const [myVehicle, setMyVehicle] = useState<
    VehicleRegistration | null | undefined
  >(undefined);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    api
      .myVehicle()
      .then((r) => setMyVehicle(r.vehicle))
      .catch(() => setMyVehicle(null));
  }, []);

  const submitted = (v: VehicleRegistration) => {
    setEditing(false);
    setMyVehicle(v);
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold sm:text-xl">Register your vehicle</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Register here ahead of time and it is ready the moment you file a
          Personal Vehicle claim — nothing left to fill in there.
        </p>
      </div>

      {myVehicle === undefined ? (
        <Card>
          <Spinner label="Checking your vehicle registration…" />
        </Card>
      ) : editing || !myVehicle || myVehicle.status === 'rejected' ? (
        <Card
          title={myVehicle ? 'Update your vehicle' : 'Register your vehicle'}
          subtitle="Reimbursement is worked out from your own vehicle's mileage, once HR or Admin approves it. One registration covers every personal-vehicle claim after that."
        >
          {myVehicle?.status === 'rejected' && (
            <div className="mb-4">
              <Notice
                tone="error"
                items={[
                  `Not approved${myVehicle.reviewNote ? ` — ${myVehicle.reviewNote}` : ''}. Update the details and submit again.`,
                ]}
              />
            </div>
          )}
          <VehicleRegisterForm
            policy={policy}
            initial={myVehicle}
            onSubmitted={submitted}
          />
        </Card>
      ) : myVehicle.status === 'pending' ? (
        <Card
          title="Personal vehicle"
          subtitle="Waiting on HR or Admin to approve this before it can be claimed against."
        >
          <div className="rounded-xl bg-muted px-4 py-3 text-sm">
            <p className="font-medium">
              {myVehicle.vehicleType} — {myVehicle.model}
            </p>
            <p className="mt-0.5 text-muted-foreground">
              {myVehicle.fuelType} · {myVehicle.mileageKmPerLitre} km per litre
            </p>
            {myVehicle.imageLink && (
              <a
                href={myVehicle.imageLink}
                target="_blank"
                rel="noreferrer"
                className="mt-1.5 inline-block text-xs font-semibold text-primary hover:underline"
              >
                View uploaded photo
              </a>
            )}
            <p className="mt-1.5 text-xs text-muted-foreground">
              Submitted{' '}
              {myVehicle.submittedAt
                ? new Date(myVehicle.submittedAt).toLocaleDateString()
                : '—'}
            </p>
          </div>
        </Card>
      ) : (
        <Card
          title="Personal vehicle"
          subtitle={`${myVehicle.vehicleType} — ${myVehicle.model} · ${myVehicle.fuelType}, ${myVehicle.mileageKmPerLitre} km/l. Approved by HR/Admin.`}
        >
          <div className="rounded-xl bg-muted px-4 py-3 text-sm">
            {myVehicle.imageLink ? (
              <a
                href={myVehicle.imageLink}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-primary hover:underline"
              >
                View vehicle photo
              </a>
            ) : (
              <p className="text-muted-foreground">
                No photo on file — add one below.
              </p>
            )}
          </div>
          <Button
            type="button"
            variant="link"
            className="mt-4 h-auto p-0 text-xs"
            onClick={() => setEditing(true)}
          >
            Update vehicle details
          </Button>
        </Card>
      )}
    </div>
  );
}
