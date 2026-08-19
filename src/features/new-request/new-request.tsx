'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Loader2, Send } from 'lucide-react';
import { Button } from '@tenminuteschool/design-system';
import { api } from '@/lib/api';
import {
  bankPayoutAllowed,
  cfgStr,
  computeRequest,
  eligibleModes,
  emptyDraft,
  impliedLegs,
} from '@/shared/policy';
import type {
  Policy,
  RequestDraft,
  SessionUser,
  VehicleRegistration,
} from '@/shared/types';
import { Notice } from '@/components/ui';
import { StepAllowances } from './components/step-allowances';
import { StepDocuments } from './components/step-documents';
import { StepTransport } from './components/step-transport';
import { StepTravelType } from './components/step-travel-type';
import { LiveSummary } from './components/live-summary';

const STEPS = ['Travel Type', 'Transportation', 'Allowances', 'Documents'];

export function NewRequestPage({
  user,
  policy,
  editing,
  onDone,
  onCancel,
}: {
  user: SessionUser;
  policy: Policy;
  editing?: { draft: RequestDraft; requestId: string } | null;
  onDone: (requestId: string) => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState(0);
  // Next/Back swaps in an entirely different set of fields; staying scrolled
  // to wherever the previous step left off — often the bottom, since that is
  // where the button just clicked lives — showed the new step's middle with
  // nothing above it to explain what was on screen.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [step]);
  const [draft, setDraft] = useState<RequestDraft>(() => {
    if (editing?.draft) return editing.draft;
    // Pre-fill the payout number from the Employees sheet so most people only
    // have to confirm it. Someone restricted from inside-city claims starts
    // on outside-city instead, rather than opening straight onto a tile
    // they're not allowed to pick.
    const start = emptyDraft(user.insideCityBlocked ? 'outside' : 'inside');
    return { ...start, bkashNumber: user.accountNumber || '' };
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // undefined = still loading, null = never registered one.
  const [myVehicle, setMyVehicle] = useState<
    VehicleRegistration | null | undefined
  >(undefined);
  useEffect(() => {
    api
      .myVehicle()
      .then((r) => setMyVehicle(r.vehicle))
      .catch(() => setMyVehicle(null));
  }, []);

  const currency = cfgStr(policy, 'CURRENCY', 'BDT');
  const set = (patch: Partial<RequestDraft>) =>
    setDraft((d) => ({ ...d, ...patch }));

  const teamSize =
    draft.travelType === 'team' ? draft.teamMembers.length + 1 : 1;
  // The rate a personal-vehicle claim prices against comes from this specific
  // employee's own approved registration — never a pending or rejected one —
  // so it rides along on a copy of `user` rather than changing what
  // computeRequest's signature expects.
  const effectiveUser = useMemo(
    () => ({
      ...user,
      registeredVehicle:
        myVehicle?.status === 'approved'
          ? {
              vehicleType: myVehicle.vehicleType,
              model: myVehicle.model,
              fuelType: myVehicle.fuelType,
              mileageKmPerLitre: myVehicle.mileageKmPerLitre,
            }
          : undefined,
    }),
    [user, myVehicle],
  );
  const computation = useMemo(
    () => computeRequest(policy, draft, effectiveUser),
    [policy, draft, effectiveUser],
  );
  const modes = useMemo(
    () =>
      eligibleModes(policy, {
        band: user.band,
        gender: user.gender,
        scope: draft.scope,
        travelType: draft.travelType,
        teamSize,
        teamGenders: draft.teamMembers.map((m) => m.gender),
        carSpecialApproval: draft.carSpecialApproval,
      }),
    [
      policy,
      user,
      draft.scope,
      draft.travelType,
      teamSize,
      draft.teamMembers,
      draft.carSpecialApproval,
    ],
  );

  // The journey the form already knows about, kept in step with it. Fares are
  // carried across so editing a date never wipes what has been typed, and any
  // extra hops added by hand are left alone at the end of the list.
  const implied = useMemo(
    () => impliedLegs(policy, draft),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only these fields actually change what a leg implies
    [
      policy,
      draft.scope,
      draft.fromDate,
      draft.toDate,
      draft.city,
      draft.route,
      draft.destination,
      draft.destinationType,
      draft.tripDirection,
      draft.purpose,
    ],
  );
  const impliedKey = implied
    .map((l) => [l.travelDate, l.mode, l.travelFrom, l.travelTo].join('|'))
    .join('\n');
  // How many legs were auto-generated last time this ran — e.g. switching a
  // two-way trip back to one-way shrinks the auto portion. Legs between the
  // new and old count were themselves auto-generated and are now stale, not
  // something the person added by hand, so they are dropped rather than left
  // behind as a lookalike "manual" trip with its own amount box.
  const prevAutoCountRef = useRef(0);
  useEffect(() => {
    // Deferred a tick so the setDraft below isn't a synchronous setState
    // call inside the effect body itself.
    queueMicrotask(() => {
      const keepFrom = Math.max(prevAutoCountRef.current, implied.length);
      setDraft((d) => {
        const kept = d.legs.slice(keepFrom);
        const merged = implied.map((l, i) => ({
          ...l,
          mode: d.legs[i]?.mode || l.mode,
          amount: d.legs[i]?.amount ?? 0,
          note: d.legs[i]?.note ?? '',
        }));
        return { ...d, legs: [...merged, ...kept] };
      });
      prevAutoCountRef.current = implied.length;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the implied set's identity, not `implied` itself
  }, [impliedKey]);

  const insideCities = policy.cities.filter((c) => c.zone === 'Inside');

  async function save(submit: boolean) {
    setBusy(true);
    setError('');
    try {
      const res = editing
        ? await api.update(editing.requestId, draft, submit)
        : await api.create(draft, submit);
      onDone(res.request.requestId);
    } catch (err) {
      setError((err as Error).message);
      setStep(STEPS.length - 1);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button
          onClick={onCancel}
          className="rounded-lg p-2 text-muted-foreground hover:bg-accent"
        >
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1 className="text-base font-bold sm:text-lg">
            {editing ? `Edit ${editing.requestId}` : 'New travel claim'}
          </h1>
          <p className="text-xs text-muted-foreground">
            The system applies your Band {user.band} policy automatically — you
            only enter what happened.
          </p>
        </div>
      </div>

      <Stepper step={step} onStep={setStep} />

      <div className="grid gap-4 sm:gap-5 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-5">
          {step === 0 && (
            <StepTravelType
              draft={draft}
              set={set}
              insideCities={insideCities.map((c) => c.city)}
              user={user}
              policy={policy}
              computation={computation}
            />
          )}
          {step === 1 && (
            <StepTransport
              draft={draft}
              set={set}
              policy={policy}
              modes={modes}
              user={user}
              currency={currency}
              impliedCount={implied.length}
              myVehicle={myVehicle}
              onVehicleChange={setMyVehicle}
            />
          )}
          {step === 2 && (
            <StepAllowances
              draft={draft}
              set={set}
              policy={policy}
              user={user}
              computation={computation}
              currency={currency}
            />
          )}
          {step === 3 && (
            <StepDocuments
              draft={draft}
              set={set}
              documentTypes={policy.documentTypes}
              payable={computation.finalPayable}
              currency={currency}
              bankAllowed={bankPayoutAllowed(policy)}
              needsReceipt={computation.needsReceipt}
              user={user}
            />
          )}

          {error && <Notice tone="error" items={[error]} />}

          <div className="sticky bottom-[4.25rem] z-10 -mx-3 flex items-center gap-2 border-t bg-background/95 px-3 py-3 backdrop-blur sm:static sm:mx-0 sm:justify-between sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 lg:bottom-0">
            <Button
              variant="outline"
              className="shrink-0 px-3 sm:px-4"
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              disabled={step === 0}
            >
              <ArrowLeft size={16} />{' '}
              <span className="hidden sm:inline">Back</span>
            </Button>
            <div className="flex flex-1 gap-2 sm:flex-none">
              <Button
                variant="outline"
                className="flex-1 whitespace-nowrap sm:flex-none"
                onClick={() => save(false)}
                disabled={busy}
              >
                Save draft
              </Button>
              {step < STEPS.length - 1 ? (
                <Button
                  className="flex-1 sm:flex-none"
                  onClick={() => setStep((s) => s + 1)}
                >
                  Next <ArrowRight size={16} />
                </Button>
              ) : (
                <Button
                  className="flex-1 whitespace-nowrap sm:flex-none"
                  onClick={() => save(true)}
                  disabled={busy || computation.errors.length > 0}
                >
                  {busy ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Send size={16} />
                  )}{' '}
                  Submit request
                </Button>
              )}
            </div>
          </div>
        </div>

        <LiveSummary
          computation={computation}
          currency={currency}
          draft={draft}
          user={user}
          policy={policy}
        />
      </div>
    </div>
  );
}

function Stepper({
  step,
  onStep,
}: {
  step: number;
  onStep: (n: number) => void;
}) {
  return (
    <ol className="flex gap-0.5 overflow-x-auto rounded-xl border bg-card p-1.5 shadow-sm sm:gap-1 sm:p-2">
      {STEPS.map((label, i) => (
        <li key={label} className="min-w-0 flex-1">
          <button
            onClick={() => onStep(i)}
            className={`flex w-full items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold transition sm:gap-2 sm:px-3 ${
              i === step
                ? 'bg-primary text-primary-foreground'
                : i < step
                  ? 'text-emerald-700 hover:bg-emerald-50'
                  : 'text-muted-foreground hover:bg-accent'
            }`}
          >
            {i < step ? (
              <Check size={14} />
            ) : (
              <span className="tabular-nums">{i + 1}</span>
            )}
            <span className="hidden sm:inline">{label}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}
