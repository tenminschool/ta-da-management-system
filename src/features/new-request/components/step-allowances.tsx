'use client';

import { useState } from 'react';
import { Input } from '@tenminuteschool/design-system';
import type { Policy, RequestDraft, SessionUser } from '@/shared/types';
import { cfgNum, computeRequest } from '@/shared/policy';
import { Card, ChoiceGrid, Field, Money, Notice } from '@/components/ui';

export function StepAllowances({
  draft,
  set,
  policy,
  user,
  computation,
  currency,
}: {
  draft: RequestDraft;
  set: (p: Partial<RequestDraft>) => void;
  policy: Policy;
  user: SessionUser;
  computation: ReturnType<typeof computeRequest>;
  currency: string;
}) {
  const inside = draft.scope === 'inside';
  const minHours = cfgNum(policy, 'PER_DIEM_MIN_HOURS', 5);
  const band = policy.bands.find((b) => b.band === user.band);

  // "Full amount" tracks the claim total live, so it stays correct as the
  // claimant fills in the rest of the form after choosing it. Synced during
  // render (no extra render, and no synchronous setState-in-effect) rather
  // than an effect.
  const trackFull = draft.advanceWanted && draft.advanceType === 'full';
  const [syncedTotal, setSyncedTotal] = useState(computation.totalClaim);
  if (trackFull && computation.totalClaim !== syncedTotal) {
    setSyncedTotal(computation.totalClaim);
    set({ advanceRequested: computation.totalClaim });
  }

  if (inside) {
    return (
      <Card
        title="Per-Diem"
        subtitle={`You worked ${computation.workingHours} hour(s). Eligibility is decided by the system, not by you.`}
      >
        <Notice
          tone={computation.perDiemEligible ? 'info' : 'warn'}
          items={[
            computation.perDiemEligible
              ? `Per-Diem of ${currency} ${computation.perDiemAmount} is approved automatically (≥ ${minHours} hours).`
              : `No Per-Diem — you worked under ${minHours} hour(s).`,
          ]}
        />
      </Card>
    );
  }

  // Outside city.
  const advanceMinDays = cfgNum(policy, 'ADVANCE_MIN_TRIP_DAYS', 3);
  return (
    <>
      <Card
        title="Per-Diem"
        subtitle="Loaded automatically from your band — no manual calculation."
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Trip length" value={`${computation.tripDays} day(s)`} />
          <Stat
            label="Weekday rate"
            value={`${currency} ${band?.outsideTAWeekday ?? 0}`}
          />
          <Stat
            label="Weekend rate"
            value={`${currency} ${band?.outsideTAWeekend ?? 0}`}
          />
        </div>
        <p className="mt-4 rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">
          {computation.weekdayDays} weekday + {computation.weekendDays} weekend
          ={' '}
          <span className="font-semibold text-foreground">
            <Money value={computation.perDiemAmount} currency={currency} />
          </span>
          . This already covers local transport and 3 meals, so no separate TA
          is claimed.
        </p>
      </Card>

      <Card
        title="Accommodation"
        subtitle={`Actual hotel bill, up to ${currency} ${band?.accommodationLimit ?? 0} per night for Band ${user.band}.`}
      >
        {draft.arrangement === 'company' ? (
          <Notice
            tone="info"
            items={[
              "Company Arrangement — the company books your hotel directly, so there's nothing to claim here. " +
                'Got a receipt or other paperwork? Attach it on the Documents step instead.',
            ]}
          />
        ) : (
          <>
            <ChoiceGrid
              value={draft.accommodationType}
              // Switching to Personal clears any hotel figures already entered,
              // so nothing is claimed for a stay with no bill.
              onChange={(v) =>
                set(
                  v === 'personal'
                    ? {
                        accommodationType: 'personal',
                        hotelName: '',
                        checkIn: '',
                        checkOut: '',
                        accommodationAmount: 0,
                      }
                    : { accommodationType: 'hotel' },
                )
              }
              options={[
                {
                  value: 'hotel',
                  label: 'Hotel',
                  description: 'Stayed at a hotel — claim the bill.',
                },
                {
                  value: 'personal',
                  label: 'Personal',
                  description:
                    'Stayed with family or friends — no hotel bill to claim.',
                },
              ]}
            />
            {draft.accommodationType !== 'personal' && (
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <Field label="Hotel name">
                  <Input
                    value={draft.hotelName}
                    onChange={(e) => set({ hotelName: e.target.value })}
                  />
                </Field>
                <Field label={`Amount (${currency})`}>
                  <Input
                    type="number"
                    min={0}
                    value={draft.accommodationAmount || ''}
                    onChange={(e) =>
                      set({ accommodationAmount: Number(e.target.value) })
                    }
                  />
                </Field>
                <Field label="Check-in">
                  <Input
                    type="date"
                    value={draft.checkIn}
                    onChange={(e) => set({ checkIn: e.target.value })}
                  />
                </Field>
                <Field label="Check-out">
                  <Input
                    type="date"
                    value={draft.checkOut}
                    onChange={(e) => set({ checkOut: e.target.value })}
                  />
                </Field>
              </div>
            )}
          </>
        )}
      </Card>

      <Card
        title="Travel advance"
        subtitle={
          computation.advanceAvailable
            ? `This trip is ${computation.tripDays} days, so you are eligible for a travel advance.`
            : !computation.noticeOK
              ? `An advance needs at least ${computation.noticeDaysRequired} business days' notice before travel.`
              : `An advance is only offered for outside-city trips of ${advanceMinDays} days or more.`
        }
      >
        {computation.advanceAvailable ? (
          <>
            <ChoiceGrid
              value={draft.advanceWanted ? 'yes' : 'no'}
              // Declining clears any figure already typed, so nothing is
              // requested by accident.
              onChange={(v) =>
                set({
                  advanceWanted: v === 'yes',
                  advanceType: v === 'yes' ? draft.advanceType : '',
                  advanceRequested: v === 'yes' ? draft.advanceRequested : 0,
                })
              }
              options={[
                {
                  value: 'yes',
                  label: 'Yes, I want an advance',
                  description:
                    'Paid before you travel, settled against this claim afterwards.',
                },
                {
                  value: 'no',
                  label: 'No, thanks',
                  description:
                    'Pay your own way and claim it all back after the trip.',
                },
              ]}
            />
            {draft.advanceWanted ? (
              <div className="mt-5 space-y-5">
                <ChoiceGrid
                  value={draft.advanceType}
                  onChange={(v) =>
                    set({
                      advanceType: v === 'full' ? 'full' : 'partial',
                      advanceRequested:
                        v === 'full'
                          ? computation.totalClaim
                          : draft.advanceRequested,
                    })
                  }
                  options={[
                    {
                      value: 'full',
                      label: 'Full amount',
                      description:
                        'The whole claim total is requested as your advance.',
                    },
                    {
                      value: 'partial',
                      label: 'Partial amount',
                      description:
                        'Type in the specific amount you need up front.',
                    },
                  ]}
                />
                {draft.advanceType === 'full' ? (
                  <Field label={`Advance needed (${currency})`}>
                    <Input
                      type="number"
                      value={computation.totalClaim}
                      disabled
                      readOnly
                    />
                  </Field>
                ) : draft.advanceType === 'partial' ? (
                  <Field label={`Advance needed (${currency})`}>
                    <Input
                      type="number"
                      min={0}
                      value={draft.advanceRequested || ''}
                      onChange={(e) =>
                        set({ advanceRequested: Number(e.target.value) })
                      }
                    />
                  </Field>
                ) : null}
              </div>
            ) : (
              <div className="mt-5">
                <Notice
                  tone="info"
                  items={[
                    `You are eligible but have declined. Nothing is paid up front — spend your own money on the trip and the full ${currency} amount comes back to you once this claim is approved.`,
                  ]}
                />
              </div>
            )}
          </>
        ) : !computation.noticeOK ? (
          <Notice
            tone="warn"
            items={[
              `Applied ${computation.noticeGiven} business day(s) before travel — an advance needs ` +
                `${computation.noticeDaysRequired} or more. There is not enough time left to pay one out before this trip. ` +
                'Contact Administration if it cannot wait.',
            ]}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            Advances start at {advanceMinDays}-day trips. This one is{' '}
            {computation.tripDays} day(s).
          </p>
        )}
        {computation.requiresDeptHeadApproval && (
          <div className="mt-3">
            <Notice
              tone="warn"
              items={[
                `Above ${currency} ${cfgNum(policy, 'ADVANCE_AUTO_LIMIT', 10000)}, this advance also needs Department Head approval.`,
              ]}
            />
          </div>
        )}
      </Card>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-sm font-bold">{value}</p>
    </div>
  );
}
