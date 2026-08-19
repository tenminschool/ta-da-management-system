'use client';

import { useState } from 'react';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@tenminuteschool/design-system';
import type {
  Leg,
  Policy,
  RequestDraft,
  VehicleRegistration,
} from '@/shared/types';
import type { ModeOption } from '@/shared/policy';
import { Card, Money } from '@/components/ui';
import { PersonalVehicleLegModal } from './personal-vehicle-leg-modal';
import { RentACarLegModal } from './rent-a-car-leg-modal';

/** Priced per traveller, not per trip — kept in step with the same set in policy.ts. */
const PER_TRAVELLER_MODES = new Set(['Bus', 'Train', 'Flight']);

export function LegsEditor({
  draft,
  set,
  currency,
  title,
  subtitle,
  autoCount,
  chained = false,
  legModes,
  policy,
  myVehicle,
  onVehicleChange,
}: {
  draft: RequestDraft;
  set: (p: Partial<RequestDraft>) => void;
  currency: string;
  title: string;
  subtitle: string;
  /** How many leading trips the form worked out for itself. */
  autoCount: number;
  /** More Ways only: lets a trip be added by hand, each one chained from the last. */
  chained?: boolean;
  legModes?: ModeOption[];
  policy: Policy;
  myVehicle: VehicleRegistration | null | undefined;
  onVehicleChange: (v: VehicleRegistration) => void;
}) {
  const legs = draft.legs;
  const teamSize =
    draft.travelType === 'team' ? draft.teamMembers.length + 1 : 1;
  const update = (i: number, patch: Partial<Leg>) =>
    set({ legs: legs.map((l, idx) => (idx === i ? { ...l, ...patch } : l)) });
  const remove = (i: number) =>
    set({ legs: legs.filter((_, idx) => idx !== i) });

  const [vehicleModalFor, setVehicleModalFor] = useState<number | null>(null);
  const [rentACarModalFor, setRentACarModalFor] = useState<number | null>(null);

  function changeMode(i: number, mode: string) {
    if (mode === 'PersonalVehicle') {
      update(i, { mode, amount: 0 });
      setVehicleModalFor(i);
    } else if (mode === 'RentACar') {
      update(i, { mode, amount: 0 });
      setRentACarModalFor(i);
    } else if (mode === 'CompanyVehicle') {
      update(i, {
        mode,
        amount: 0,
        note: 'Company vehicle — no reimbursement.',
      });
    } else {
      update(i, { mode });
    }
  }

  const modeSelect = (leg: Leg, i: number) => (
    <Select
      value={leg.mode || undefined}
      onValueChange={(mode) => changeMode(i, mode)}
    >
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Mode" />
      </SelectTrigger>
      <SelectContent>
        {(legModes || [])
          .filter((m) => m.enabled)
          .map((m) => (
            <SelectItem key={m.mode} value={m.mode}>
              {m.label}
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  );

  // What this leg's amount box actually is depends on the mode picked —
  // most are a plain fare, but the three "special" ones each hand off to
  // their own picker instead of a raw number.
  const amountCell = (leg: Leg, i: number) => {
    if (leg.mode === 'CompanyVehicle') {
      return (
        <p className="flex h-9 items-center rounded-md border border-input px-3 text-sm text-muted-foreground">
          Free — no cost
        </p>
      );
    }
    if (leg.mode === 'PersonalVehicle' || leg.mode === 'RentACar') {
      return (
        <button
          type="button"
          className="flex h-9 w-full items-center justify-between rounded-md border border-input px-3 text-left text-sm"
          onClick={() =>
            leg.mode === 'PersonalVehicle'
              ? setVehicleModalFor(i)
              : setRentACarModalFor(i)
          }
        >
          <span
            className={leg.amount > 0 ? 'font-medium' : 'text-muted-foreground'}
          >
            {leg.amount > 0 ? (
              <Money value={leg.amount} currency={currency} />
            ) : (
              'Enter details'
            )}
          </span>
          <ChevronDown size={14} className="-rotate-90 text-muted-foreground" />
        </button>
      );
    }
    const perTraveller = teamSize > 1 && PER_TRAVELLER_MODES.has(leg.mode);
    return (
      <div>
        <Input
          type="number"
          inputMode="decimal"
          min={0}
          placeholder={
            perTraveller ? `Per ticket (${currency})` : `Amount (${currency})`
          }
          value={leg.amount || ''}
          onChange={(e) => update(i, { amount: Number(e.target.value) })}
        />
        {perTraveller && leg.amount > 0 && (
          <p className="mt-1 text-xs text-muted-foreground">
            {leg.amount} × {teamSize} travellers ={' '}
            <Money value={leg.amount * teamSize} currency={currency} />
          </p>
        )}
      </div>
    );
  };

  const legTotal = legs.reduce((sum, l) => {
    if (l.mode === 'CompanyVehicle') return sum;
    const multiplier =
      teamSize > 1 && PER_TRAVELLER_MODES.has(l.mode) ? teamSize : 1;
    return sum + (Number(l.amount) || 0) * multiplier;
  }, 0);

  return (
    <Card
      title={title}
      subtitle={subtitle}
      actions={
        chained && (
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              set({
                legs: [
                  ...legs,
                  {
                    travelDate: draft.fromDate,
                    // Chained trips continue from wherever the last leg left
                    // off, defaulting to the same mode too — both are still
                    // editable, but most multi-stop errands stay on one.
                    mode: legs[legs.length - 1]?.mode || '',
                    travelFrom: legs[legs.length - 1]?.travelTo || '',
                    travelTo: '',
                    amount: 0,
                    note: '',
                  },
                ],
              })
            }
          >
            <Plus size={14} /> Add another trip
          </Button>
        )
      }
    >
      {!legs.length ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Choose your dates and destination first — the trip is filled in from
          those.
        </p>
      ) : (
        <div className="space-y-3">
          {legs.map((leg, i) => (
            <div key={i} className="rounded-xl border p-3">
              {i < autoCount ? (
                /* Worked out from the trip already described, so there is
                   nothing here to re-enter but the mode and the fare. */
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">
                      {leg.travelFrom || '—'} → {leg.travelTo || '—'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {leg.travelDate || '—'}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <div className="w-36">{modeSelect(leg, i)}</div>
                    <div className="w-40">{amountCell(leg, i)}</div>
                  </div>
                </div>
              ) : (
                /* A More Ways stop: same day, continuing from wherever the
                   last leg ended — only where it goes next is new. */
                <>
                  <div className="mb-2 flex items-center justify-between sm:hidden">
                    <span className="text-xs font-bold text-muted-foreground">
                      Trip {i + 1}
                    </span>
                    <button
                      onClick={() => remove(i)}
                      className="rounded-lg p-2 text-muted-foreground active:bg-destructive/10 active:text-destructive"
                      aria-label="Remove trip"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <div className="grid gap-2.5 sm:grid-cols-[8rem_1fr_1fr_9rem_10rem_auto] sm:items-center sm:gap-3">
                    <span className="text-sm text-muted-foreground">
                      {leg.travelDate || '—'}
                    </span>
                    <span className="truncate text-sm text-muted-foreground">
                      {leg.travelFrom || '—'}
                    </span>
                    <Input
                      placeholder="Where next?"
                      value={leg.travelTo}
                      onChange={(e) => update(i, { travelTo: e.target.value })}
                    />
                    {modeSelect(leg, i)}
                    {amountCell(leg, i)}
                    <button
                      onClick={() => remove(i)}
                      className="hidden rounded-lg p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive sm:block"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
          <p className="text-right text-sm font-semibold">
            Total: <Money value={legTotal} currency={currency} />
          </p>
        </div>
      )}

      {vehicleModalFor !== null && (
        <PersonalVehicleLegModal
          policy={policy}
          currency={currency}
          myVehicle={myVehicle}
          onVehicleChange={onVehicleChange}
          initial={legs[vehicleModalFor]}
          onClose={() => setVehicleModalFor(null)}
          onSave={(patch) => {
            update(vehicleModalFor, patch);
            setVehicleModalFor(null);
          }}
        />
      )}

      {rentACarModalFor !== null && (
        <RentACarLegModal
          policy={policy}
          currency={currency}
          initial={legs[rentACarModalFor]}
          headcount={draft.rentACarHeadcount}
          onClose={() => setRentACarModalFor(null)}
          onSave={(patch, headcount) => {
            update(rentACarModalFor, patch);
            set({ rentACarHeadcount: headcount });
            setRentACarModalFor(null);
          }}
        />
      )}
    </Card>
  );
}
