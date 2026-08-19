'use client';

import { Textarea } from '@tenminuteschool/design-system';
import type {
  Policy,
  RequestDraft,
  SessionUser,
  VehicleRegistration,
} from '@/shared/types';
import type { ModeOption } from '@/shared/policy';
import { Card, ChoiceGrid, Field, Notice, Toggle } from '@/components/ui';
import { LegsEditor } from './legs-editor';

export function StepTransport({
  draft,
  set,
  policy,
  modes,
  user,
  currency,
  impliedCount,
  myVehicle,
  onVehicleChange,
}: {
  draft: RequestDraft;
  set: (p: Partial<RequestDraft>) => void;
  policy: Policy;
  modes: ModeOption[];
  user: SessionUser;
  currency: string;
  impliedCount: number;
  myVehicle: VehicleRegistration | null | undefined;
  onVehicleChange: (v: VehicleRegistration) => void;
}) {
  const inside = draft.scope === 'inside';
  const juniorMale =
    inside &&
    !String(user.gender).toLowerCase().startsWith('f') &&
    modes.some(
      (m) =>
        m.mode === 'Car' && !m.enabled && m.reason.includes('pre-approval'),
    );
  const anyLegNeedsReceipt = draft.legs.some(
    (l) => modes.find((m) => m.mode === l.mode)?.requiresReceipt,
  );

  if (draft.scope === 'outside' && draft.arrangement === 'company') {
    return (
      <Card title="Transportation">
        <Notice
          tone="info"
          items={[
            "Company Arrangement — the company books your transport directly, so there's nothing to pick or claim here. " +
              'Got a ticket or other paperwork? Attach it on the Documents step instead.',
          ]}
        />
      </Card>
    );
  }

  return (
    <>
      <Card
        title="One way, or there and back?"
        subtitle={`Only the modes your Band ${user.band} policy allows are offered per trip below${draft.travelType === 'team' ? `, adjusted for a team of ${draft.teamMembers.length + 1}` : ''}.`}
      >
        <ChoiceGrid
          columns={3}
          value={draft.tripDirection}
          onChange={(tripDirection) =>
            set({
              tripDirection: tripDirection as RequestDraft['tripDirection'],
              // Stepping back out of More Ways drops whatever extra stops
              // were chained on — One way and Two way have no "add" button
              // to remove them with otherwise.
              legs:
                tripDirection === 'more_ways'
                  ? draft.legs
                  : draft.legs.slice(0, impliedCount),
            })
          }
          options={
            inside
              ? [
                  {
                    value: 'one_way',
                    label: 'One way',
                    description: 'Office to the destination — a single fare.',
                  },
                  {
                    value: 'two_way',
                    label: 'Two way',
                    description:
                      'Office to the destination, and back to office — two fares.',
                  },
                  {
                    value: 'more_ways',
                    label: 'More Ways',
                    description:
                      'Several stops in one trip — add each leg as you go.',
                  },
                ]
              : [
                  {
                    value: 'one_way',
                    label: 'One way',
                    description: 'Departure only — a single ticket.',
                  },
                  {
                    value: 'two_way',
                    label: 'Two way',
                    description: 'There and back — two tickets.',
                  },
                  {
                    value: 'more_ways',
                    label: 'More Ways',
                    description:
                      'Several stops on the way — add each leg as you go.',
                  },
                ]
          }
        />
      </Card>

      <LegsEditor
        draft={draft}
        set={set}
        currency={currency}
        autoCount={impliedCount}
        // One way and Two way are exactly the fare(s) the trip implies —
        // nothing to add by hand. More Ways is a chain of stops the
        // traveller builds up themselves, so each new leg starts where the
        // last one left off rather than blank.
        chained={draft.tripDirection === 'more_ways'}
        legModes={modes}
        policy={policy}
        myVehicle={myVehicle}
        onVehicleChange={onVehicleChange}
        title={inside ? 'Trips taken' : 'Travel tickets'}
        subtitle={
          anyLegNeedsReceipt
            ? "Pick each trip's mode and enter what it cost — reimbursed against actual receipts where one is issued."
            : "Pick each trip's mode and enter what it cost — no receipt needed for the modes used so far."
        }
      />

      {juniorMale && (
        <Toggle
          checked={draft.carSpecialApproval}
          onChange={(carSpecialApproval) => set({ carSpecialApproval })}
          label="Car was pre-approved for this trip"
          hint="Attach the approval mail in the Documents step — Administration will verify it."
        />
      )}

      {inside && (
        <Card title="Any exception?">
          <div className="space-y-3">
            <Toggle
              checked={draft.exceptionClaimed}
              onChange={(exceptionClaimed) =>
                set({
                  exceptionClaimed,
                  exceptionReason: exceptionClaimed
                    ? draft.exceptionReason
                    : '',
                })
              }
              label="I had to travel outside my band's transport policy"
              hint="Only when the trip genuinely left no choice — a late-night journey where a car was the safe option, for example. Ticking this opens every mode your band would otherwise not allow."
            />
            {draft.exceptionClaimed && (
              <>
                <Field label="Why was this necessary?" required>
                  <Textarea
                    className="min-h-20"
                    value={draft.exceptionReason}
                    onChange={(e) => set({ exceptionReason: e.target.value })}
                    placeholder="Returned from the Uttara shoot at 1:30am — no CNG or rickshaw available at that hour, so a car was the only safe way home."
                  />
                </Field>
                <Notice
                  tone="warn"
                  items={[
                    'An approver reads this and decides. Without a reason that stands up, the claim comes back — so say what happened, when, and why the usual option was not available.',
                  ]}
                />
              </>
            )}
          </div>
        </Card>
      )}
    </>
  );
}
