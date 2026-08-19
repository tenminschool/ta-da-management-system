'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { Policy, RequestDraft, SessionUser } from '@/shared/types';
import { computeRequest, insidePerTravellerAmount } from '@/shared/policy';
import { Money, Notice } from '@/components/ui';

export function LiveSummary({
  computation,
  currency,
  draft,
  user,
  policy,
}: {
  computation: ReturnType<typeof computeRequest>;
  currency: string;
  draft: RequestDraft;
  user: SessionUser;
  policy: Policy;
}) {
  // Collapsed by default on phones: the running total stays visible without
  // pushing the actual form off the screen. Always open from lg up.
  const [open, setOpen] = useState(false);

  // Per-Diem is the only line split per traveller — everything else
  // (transport, accommodation, rent-a-car…) is a single receipt or a flat
  // amount for the whole group, so only this one gets an itemised breakdown.
  // Each person's own cut comes from their own "office meal taken?" answer —
  // never a team total divided evenly, or one person's answer would look
  // like it changed everyone's amount.
  const isTeam = draft.travelType === 'team' && draft.teamMembers.length > 0;
  const ownPerDiem = (mealTaken: boolean) =>
    insidePerTravellerAmount(policy, computation.workingHours, mealTaken);
  const requesterPerDiem = ownPerDiem(
    draft.dualWorkstation ? true : draft.officeMealTaken,
  );

  const teamPerDiemBreakdown =
    isTeam && (computation.perDiemAmount > 0 || computation.lunchAllowance > 0);
  const breakdownLabel =
    computation.perDiemAmount > 0 ? 'Per-Diem' : 'Lunch allowance';
  const breakdownTotal =
    computation.perDiemAmount > 0
      ? computation.perDiemAmount
      : computation.lunchAllowance;

  const lines: [string, number][] = [
    // Rent-a-car and Flight are trips too now, so their cost is already
    // folded into Transportation — showing them again here would look like
    // it was charged twice.
    ['Transportation', computation.taAmount],
    ...(isTeam
      ? []
      : [
          ['Per-Diem', computation.perDiemAmount] as [string, number],
          ['Lunch allowance', computation.lunchAllowance] as [string, number],
        ]),
    ['Accommodation', computation.accommodationAmount],
    ['Other', computation.otherAmount],
  ];
  const hasLines = lines.some(([, v]) => v > 0) || teamPerDiemBreakdown;

  const body = (
    <>
      <div className="space-y-2 px-4 py-4 text-sm sm:px-5">
        {teamPerDiemBreakdown && (
          <div>
            <span className="mb-1 block text-muted-foreground">
              {breakdownLabel}
            </span>
            <div className="space-y-1 border-l-2 pl-3">
              <div className="flex justify-between gap-3 text-xs">
                <span className="text-muted-foreground">{user.name} (you)</span>
                <span>
                  <Money value={requesterPerDiem} currency={currency} />
                </span>
              </div>
              {draft.teamMembers.map((m, i) => (
                <div
                  key={m.employeeId || i}
                  className="flex justify-between gap-3 text-xs"
                >
                  <span className="text-muted-foreground">
                    {m.name || `Team member ${i + 1}`}
                  </span>
                  <span>
                    <Money
                      value={ownPerDiem(m.officeMealTaken)}
                      currency={currency}
                    />
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-1.5 flex justify-between gap-3">
              <span className="text-xs font-medium text-muted-foreground">
                {breakdownLabel} total
              </span>
              <span className="font-medium">
                <Money value={breakdownTotal} currency={currency} />
              </span>
            </div>
          </div>
        )}
        {lines
          .filter(([, v]) => v > 0)
          .map(([label, value]) => (
            <div key={label} className="flex justify-between gap-3">
              <span className="text-muted-foreground">{label}</span>
              <span className="font-medium">
                <Money value={value} currency={currency} />
              </span>
            </div>
          ))}
        {!hasLines && (
          <p className="text-muted-foreground">Nothing calculated yet.</p>
        )}
        <div className="mt-3 flex justify-between gap-3 border-t pt-3">
          <span className="font-semibold">Total claim</span>
          <span className="font-bold">
            <Money value={computation.totalClaim} currency={currency} />
          </span>
        </div>
        {computation.advanceRequested > 0 && (
          <>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Less advance</span>
              <span className="font-medium text-rose-600">
                −{' '}
                <Money
                  value={computation.advanceRequested}
                  currency={currency}
                />
              </span>
            </div>
            <div className="flex justify-between gap-3 border-t pt-2">
              <span className="font-semibold">Final payable</span>
              <span className="font-bold text-emerald-600">
                <Money value={computation.finalPayable} currency={currency} />
              </span>
            </div>
          </>
        )}
      </div>

      <div className="space-y-3 px-4 pb-4 sm:px-5">
        <Notice
          tone="error"
          title="Fix before submitting"
          items={computation.errors}
        />
        <Notice
          tone="warn"
          title="Needs attention"
          items={computation.warnings}
        />
        <Notice
          tone="info"
          title="How this was calculated"
          items={computation.notes}
        />
      </div>
    </>
  );

  return (
    <aside className="order-first lg:sticky lg:top-6 lg:order-none lg:self-start">
      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        {/* Phone header doubles as the toggle; desktop is a plain title. */}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center justify-between gap-3 border-b bg-muted px-4 py-3 text-left lg:cursor-default lg:px-5"
        >
          <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Live calculation
          </span>
          <span className="flex items-center gap-2">
            <span className="text-sm font-bold lg:hidden">
              <Money value={computation.totalClaim} currency={currency} />
            </span>
            {computation.errors.length > 0 && (
              <span className="flex size-5 items-center justify-center rounded-full bg-rose-500 text-[10px] font-bold text-white lg:hidden">
                {computation.errors.length}
              </span>
            )}
            <ChevronDown
              size={16}
              className={`text-muted-foreground transition-transform lg:hidden ${open ? 'rotate-180' : ''}`}
            />
          </span>
        </button>

        <div className={open ? 'block' : 'hidden lg:block'}>{body}</div>
      </div>
    </aside>
  );
}
