'use client';

import { useEffect, useState } from 'react';
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
import type {
  Policy,
  RequestDraft,
  SessionUser,
  UnlockRequest,
} from '@/shared/types';
import {
  addDays,
  cfgNum,
  cfgStr,
  computeRequest,
  todayISO,
} from '@/shared/policy';
import { Card, ChoiceGrid, Field, Notice, Toggle } from '@/components/ui';
import { ContactHrModal } from './contact-hr-modal';
import { TeamPicker } from './team-picker';

/** A plain ISO date, read the way a person would say it — "22 Aug 2026". */
function fmtDate(date: string | undefined): string {
  if (!date) return '—';
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function StepTravelType({
  draft,
  set,
  insideCities,
  user,
  policy,
  computation,
}: {
  draft: RequestDraft;
  set: (p: Partial<RequestDraft>) => void;
  insideCities: string[];
  user: SessionUser;
  policy: Policy;
  computation: ReturnType<typeof computeRequest>;
}) {
  // Some destinations only exist in some cities — Other Office is Dhaka-only.
  const destinationOptions = policy.destinationTypes.filter(
    (d) => !d.cities.length || d.cities.includes(draft.city),
  );
  const outside = draft.scope === 'outside';
  const route = policy.routes.find((r) => r.value === draft.route);

  // "Contact HR" — a claim-window exception, asked for right where the date
  // picker refuses an older date, instead of having to be told to go find
  // someone. A pending or just-decided request for the same reason shouldn't
  // let someone spam a fresh one every time they reopen the form.
  const [myUnlocks, setMyUnlocks] = useState<UnlockRequest[]>([]);
  const [contactHrOpen, setContactHrOpen] = useState(false);
  const refreshMyUnlocks = () =>
    api
      .unlockRequests('mine')
      .then((r) => setMyUnlocks(r.requests))
      .catch(() => {});
  useEffect(() => {
    // Deferred a tick so this isn't a synchronous setState call inside the
    // effect body itself.
    queueMicrotask(refreshMyUnlocks);
  }, []);
  const latestUnlock = myUnlocks[0];
  const destination = destinationOptions.find(
    (d) => d.value === draft.destinationType,
  );
  const destinationNeeds = destination?.needs;
  const destinationLabel = destination?.label || '';

  // A claim has to be filed within this many days of the trip ending —
  // inside city, that is the travel date itself; outside city, the return.
  // Administration can lift this per person from Configuration, which is
  // exactly what unlocks the calendar back open here too.
  const claimWindowDays = cfgNum(policy, 'CLAIM_WINDOW_DAYS', 7);
  // claimUnlockFrom (Configuration's own tool) opens the window from a date
  // onward; claimUnlockExact (an approved "Contact HR" request) only ever
  // covers the one trip that was actually asked about.
  const claimWindowUnlocked = !!user.claimUnlockFrom || !!user.claimUnlockExact;
  const earliestClaimableDate =
    user.claimUnlockFrom ||
    user.claimUnlockExact ||
    addDays(todayISO(), -claimWindowDays);
  const unlockHint = user.claimUnlockFrom
    ? `Administration has unlocked late filing for you back to ${fmtDate(user.claimUnlockFrom)}.`
    : user.claimUnlockExact
      ? `Administration has unlocked exactly ${fmtDate(user.claimUnlockExact)} for you — no other older date.`
      : '';

  // Company Arrangement chosen against one date can go stale if the date is
  // pushed closer — dropped back to Self rather than left selected behind a
  // disabled option nobody notices. Reset during render (no extra render,
  // and no synchronous setState-in-effect) rather than an effect.
  const [checkedNoticeFor, setCheckedNoticeFor] = useState(
    computation.noticeOK,
  );
  if (computation.noticeOK !== checkedNoticeFor) {
    setCheckedNoticeFor(computation.noticeOK);
    if (draft.arrangement === 'company' && !computation.noticeOK)
      set({ arrangement: 'self' });
  }

  return (
    <>
      <Card title="What type of travel are you making?">
        <ChoiceGrid
          value={draft.scope}
          onChange={(scope) =>
            set({
              scope,
              city: scope === 'inside' ? insideCities[0] || '' : '',
              // Outside-city asks for a return date; inside-city is a single day.
              toDate: scope === 'inside' ? draft.fromDate : '',
              // Route belongs to outside-city, destination to inside-city;
              // neither should survive a switch to the other.
              route: '',
              destinationType: '',
              destination: '',
              purpose: '',
              transportMode: '',
              tripDirection: 'one_way',
            })
          }
          options={[
            {
              value: 'inside',
              label: 'Inside City',
              description: `Same-city travel — ${insideCities.join(', ')}`,
              disabled: user.insideCityBlocked,
              reason: user.insideCityBlocked
                ? 'Administration has restricted inside-city claims for you. Contact them if this needs to change.'
                : undefined,
            },
            {
              value: 'outside',
              label: 'Outside City',
              description:
                'Travel to another district, with per-diem and accommodation',
            },
          ]}
        />

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {draft.scope === 'outside' ? (
            <>
              <Field label="Route" required>
                <Select
                  value={draft.route || undefined}
                  // The city is the route's end, so it is set here — except on
                  // an "Other city" route, where it is what gets typed next.
                  // Destination follows the city; it stays editable for anyone
                  // who wants to name the actual office rather than the city.
                  onValueChange={(value) => {
                    const picked = policy.routes.find((r) => r.value === value);
                    const touchesDhaka =
                      picked?.from === 'Dhaka' || picked?.to === 'Dhaka';
                    set({
                      route: value,
                      city: picked?.to || '',
                      destination: picked?.to || '',
                      dhakaOffice: touchesDhaka ? draft.dhakaOffice : '',
                    });
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a route" />
                  </SelectTrigger>
                  <SelectContent>
                    {policy.routes.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              {route && !route.to && (
                <Field label={`${route.from} to`} required>
                  <Input
                    value={draft.city}
                    onChange={(e) =>
                      set({ city: e.target.value, destination: e.target.value })
                    }
                    placeholder="Which city?"
                  />
                </Field>
              )}

              {/* Dhaka has several offices to choose between; Chattogram, so
                  far, does not. The question reads differently depending on
                  which end of the route Dhaka is. */}
              {route && (route.from === 'Dhaka' || route.to === 'Dhaka') && (
                <Field
                  label={
                    route.from === 'Dhaka'
                      ? 'From which Dhaka office are you travelling?'
                      : 'Which Dhaka office are you going to?'
                  }
                  required
                >
                  <Select
                    value={draft.dhakaOffice || undefined}
                    onValueChange={(v) => set({ dhakaOffice: v })}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select an office" />
                    </SelectTrigger>
                    <SelectContent>
                      {policy.otherOffices.map((o) => (
                        <SelectItem key={o} value={o}>
                          {o}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
            </>
          ) : (
            <Field label="City" required>
              <Select
                value={draft.city || undefined}
                onValueChange={(city) => {
                  // Moving to a city where the chosen destination does not exist
                  // would otherwise leave it selected but off the list.
                  const stillOffered = policy.destinationTypes.some(
                    (d) =>
                      d.value === draft.destinationType &&
                      (!d.cities.length || d.cities.includes(city)),
                  );
                  set(
                    stillOffered
                      ? { city }
                      : {
                          city,
                          destinationType: '',
                          destination: '',
                          purpose: '',
                        },
                  );
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a city" />
                </SelectTrigger>
                <SelectContent>
                  {insideCities.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}

          {/* Inside-city trips name where they went right here, next to the
              city. Outside-city keeps the free-text pair on Trip details. */}
          {draft.scope === 'inside' && draft.city && (
            <>
              <Field label="Destination" required>
                <Select
                  value={draft.destinationType || undefined}
                  // Both follow-ups are cleared on a change of mind, so a name
                  // typed for a University cannot survive into an Other Office.
                  onValueChange={(v) =>
                    set({ destinationType: v, destination: '', purpose: '' })
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a destination" />
                  </SelectTrigger>
                  <SelectContent>
                    {destinationOptions.map((d) => (
                      <SelectItem key={d.value} value={d.value}>
                        {d.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              {destinationNeeds === 'name' && (
                <>
                  <Field label={`${destinationLabel} name`} required>
                    <Input
                      value={draft.destination}
                      onChange={(e) => set({ destination: e.target.value })}
                      placeholder={`Which ${destinationLabel.toLowerCase()}?`}
                    />
                  </Field>
                  <Field label="Purpose" required>
                    <Input
                      value={draft.purpose}
                      onChange={(e) => set({ purpose: e.target.value })}
                      placeholder="Partner meeting, campus activation…"
                    />
                  </Field>
                </>
              )}

              {destinationNeeds === 'office' && (
                <Field label="Office name" required>
                  <Select
                    value={draft.purpose || undefined}
                    onValueChange={(v) => set({ purpose: v })}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select an office" />
                    </SelectTrigger>
                    <SelectContent>
                      {policy.otherOffices.map((o) => (
                        <SelectItem key={o} value={o}>
                          {o}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}

              {destinationNeeds === 'purpose' && (
                <Field label="Purpose" required>
                  <Input
                    value={draft.purpose}
                    onChange={(e) => set({ purpose: e.target.value })}
                    placeholder="Where you went and why"
                  />
                </Field>
              )}
            </>
          )}

          <Field
            label={outside ? 'Departure date' : 'Travel date'}
            required
            hint={
              !outside
                ? claimWindowUnlocked
                  ? unlockHint
                  : `Claims must be filed within ${claimWindowDays} days of travel, so the calendar only goes back to ${fmtDate(earliestClaimableDate)}. Need an older date? Reach out to Administration.`
                : undefined
            }
          >
            <Input
              type="date"
              value={draft.fromDate}
              min={!outside ? earliestClaimableDate || undefined : undefined}
              onChange={(e) =>
                set({
                  fromDate: e.target.value,
                  toDate: outside ? draft.toDate : e.target.value,
                })
              }
            />
          </Field>
          {outside && (
            <Field
              label="Return date"
              required
              hint={
                claimWindowUnlocked
                  ? unlockHint
                  : `Claims must be filed within ${claimWindowDays} days of your return, so the calendar only goes back to ${fmtDate(earliestClaimableDate)}. Need an older date? Reach out to Administration.`
              }
            >
              <Input
                type="date"
                value={draft.toDate}
                min={earliestClaimableDate || undefined}
                onChange={(e) => set({ toDate: e.target.value })}
              />
            </Field>
          )}

          {!claimWindowUnlocked && (
            <div className="space-y-2 sm:col-span-2">
              {latestUnlock?.status === 'pending' && (
                <Notice
                  tone="info"
                  items={[
                    `Your request to unlock ${fmtDate(latestUnlock.requestedFrom)} is with Administration — check back here once they decide.`,
                  ]}
                />
              )}
              {latestUnlock?.status === 'rejected' && (
                <Notice
                  tone="warn"
                  items={[
                    `Your last request was declined${latestUnlock.decidedBy ? ` by ${latestUnlock.decidedBy.replace(/<.*>/, '').trim()}` : ''}: ${latestUnlock.decisionRemarks}`,
                  ]}
                />
              )}
              {latestUnlock?.status !== 'pending' && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-xs"
                  onClick={() => setContactHrOpen(true)}
                >
                  Contact HR — ask to unlock an older date
                </Button>
              )}
            </div>
          )}
          {contactHrOpen && (
            <ContactHrModal
              defaultDate={draft.fromDate}
              onClose={() => setContactHrOpen(false)}
              onDone={() => {
                setContactHrOpen(false);
                refreshMyUnlocks();
              }}
            />
          )}

          <div className="sm:col-span-2">
            <Notice
              tone="warn"
              items={[
                'Enter your travel date exactly as it happened — a manipulated or falsified date is grounds for rejecting this request.',
              ]}
            />
          </div>

          {draft.scope === 'outside' && (
            <Field label="Travel arrangement" required>
              <Select
                value={draft.arrangement}
                // Company Arrangement means the company books the hotel
                // directly, so any hotel figures already entered no longer
                // apply.
                onValueChange={(value) => {
                  const arrangement = value as RequestDraft['arrangement'];
                  set(
                    arrangement === 'company'
                      ? {
                          arrangement,
                          accommodationType: '',
                          hotelName: '',
                          checkIn: '',
                          checkOut: '',
                          accommodationAmount: 0,
                        }
                      : { arrangement },
                  );
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="self">Self Arrangement</SelectItem>
                  <SelectItem value="company" disabled={!computation.noticeOK}>
                    Company Arrangement
                    {!computation.noticeOK ? ' — needs more notice' : ''}
                  </SelectItem>
                </SelectContent>
              </Select>
            </Field>
          )}

          {draft.scope === 'outside' && !computation.noticeOK && (
            <div className="sm:col-span-2">
              <Notice
                tone="warn"
                items={[
                  `Company Arrangement and a travel advance both need at least ${computation.noticeDaysRequired} business ` +
                    `days' notice before travel${draft.fromDate ? ` — this trip is only ${computation.noticeGiven} business day(s) away` : ''}. ` +
                    'Choose Self Arrangement, or contact Administration if this cannot wait.',
                ]}
              />
            </div>
          )}

          {/* Inside-city says where it went above, beside the city. */}
          {outside && (
            <>
              <Field
                label="Destination"
                hint="Set from the route you picked above."
              >
                <Input value={draft.destination} disabled readOnly />
              </Field>
              <Field label="Purpose" required>
                <Input
                  value={draft.purpose}
                  onChange={(e) => set({ purpose: e.target.value })}
                  placeholder="Partner meeting, campus activation…"
                />
              </Field>
            </>
          )}
        </div>
      </Card>

      <Card title="Who is travelling?">
        <ChoiceGrid
          value={draft.travelType}
          onChange={(travelType) =>
            set({
              travelType,
              teamMembers: travelType === 'individual' ? [] : draft.teamMembers,
            })
          }
          options={[
            {
              value: 'individual',
              label: 'Individual',
              description: `Just you — Band ${user.band}`,
            },
            {
              value: 'team',
              label: 'Team',
              description: 'Add colleagues travelling with you',
            },
          ]}
        />
        {draft.travelType === 'team' && (
          <div className="mt-5">
            <TeamPicker
              members={draft.teamMembers}
              onChange={(teamMembers) => set({ teamMembers })}
              excludeId={user.employeeId}
            />
          </div>
        )}
      </Card>

      {!outside && (
        <Card
          title="Working hours"
          subtitle="Worked out from these two times — TA, Per-Diem or both follow from them."
        >
          {/* A trip to one of our own offices is checked against the attendance
              record, so the punches are what make the claim provable. Said here,
              above the times, rather than only in the panel on the right. */}
          {destinationNeeds === 'office' && (
            <div className="mb-4">
              <Notice
                tone="warn"
                items={[
                  'You must punch the card both in and out at the office. Without both punches this claim will be rejected.',
                ]}
              />
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Start time" required>
              <Input
                type="time"
                value={draft.startTime}
                onChange={(e) => set({ startTime: e.target.value })}
              />
            </Field>
            <Field label="End time" required>
              <Input
                type="time"
                value={draft.endTime}
                onChange={(e) => set({ endTime: e.target.value })}
              />
            </Field>
          </div>
          {draft.travelType === 'team' && draft.teamMembers.length > 0 ? (
            <div className="mt-4 space-y-2">
              <p className="text-sm font-medium">
                Office meal taken? — answer for each traveller
              </p>
              <Toggle
                checked={draft.dualWorkstation ? true : draft.officeMealTaken}
                disabled={draft.dualWorkstation}
                onChange={(officeMealTaken) => set({ officeMealTaken })}
                label={`${user.name} (you)`}
                hint={
                  draft.dualWorkstation
                    ? 'Assumed taken on a dual-workstation day.'
                    : undefined
                }
              />
              {draft.teamMembers.map((m, i) => (
                <Toggle
                  key={m.employeeId || i}
                  checked={m.officeMealTaken}
                  onChange={(officeMealTaken) =>
                    set({
                      teamMembers: draft.teamMembers.map((x, idx) =>
                        idx === i ? { ...x, officeMealTaken } : x,
                      ),
                    })
                  }
                  label={m.name || `Team member ${i + 1}`}
                />
              ))}
              <p className="text-xs text-muted-foreground">
                If someone&apos;s office meal was covered,{' '}
                {cfgNum(policy, 'OFFICE_MEAL_DEDUCTION', 75)}{' '}
                {cfgStr(policy, 'CURRENCY', 'BDT')} comes off their own Per-Diem
                — the claim is adjusted per person, not for the whole team at
                once.
              </p>
            </div>
          ) : (
            <div className="mt-4">
              <Toggle
                checked={draft.dualWorkstation ? true : draft.officeMealTaken}
                disabled={draft.dualWorkstation}
                onChange={(officeMealTaken) => set({ officeMealTaken })}
                label="Office meal taken?"
                hint={`If the office provided a meal, ${cfgNum(policy, 'OFFICE_MEAL_DEDUCTION', 75)} ${cfgStr(policy, 'CURRENCY', 'BDT')} is deducted from your Per-Diem — otherwise the full amount is paid.`}
              />
            </div>
          )}
        </Card>
      )}
    </>
  );
}
