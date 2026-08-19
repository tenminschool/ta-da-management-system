'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Banknote,
  Check,
  CircleDot,
  Clock,
  ExternalLink,
  FileText,
  HandCoins,
  Link as LinkIcon,
  Pencil,
  RotateCcw,
  X,
} from 'lucide-react';
import { Button } from '@tenminuteschool/design-system';
import { api, type RequestDetail as Detail } from '@/lib/api';
import { useSession } from '@/hooks/use-session';
import type { ApprovalRow, Policy, SessionUser } from '@/shared/types';
import { TRACK_STAGES } from '@/shared/types';
import {
  cfgNum,
  cfgStr,
  insidePerTravellerAmount,
  money,
} from '@/shared/policy';
import {
  Card,
  Empty,
  Field,
  Modal,
  Money,
  Notice,
  ProgressBar,
  Spinner,
  StatusBadge,
} from '@/components/ui';
import { ActionModal } from './components/action-modal';
import { AdvanceModal } from './components/advance-modal';
import { CompanyAmountsCard } from './components/company-amounts-card';
import { PaymentModal } from './components/payment-modal';

export function RequestDetailPage({
  requestId,
  user,
  policy,
}: {
  requestId: string;
  user: SessionUser;
  policy: Policy;
}) {
  const router = useRouter();
  const { refreshInbox } = useSession();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [action, setAction] = useState<
    'approve' | 'reject' | 'return' | 'request_docs' | null
  >(null);
  const [paying, setPaying] = useState(false);
  const [advanceAction, setAdvanceAction] = useState<
    'approve' | 'settle' | 'reject' | null
  >(null);
  const [acking, setAcking] = useState(false);
  const [ackError, setAckError] = useState('');
  const [disputing, setDisputing] = useState(false);
  const [disputeNote, setDisputeNote] = useState('');
  const currency = cfgStr(policy, 'CURRENCY', 'BDT');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setDetail(await api.request(requestId));
      setError('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [requestId]);
  useEffect(() => {
    // Deferred a tick so `load`'s own setLoading(true) isn't a synchronous
    // setState call inside the effect body itself.
    queueMicrotask(load);
  }, [load]);

  const onChanged = useCallback(() => {
    refreshInbox();
  }, [refreshInbox]);

  if (loading) return <Spinner />;
  if (error || !detail)
    return <Notice tone="error" items={[error || 'Request not found.']} />;

  const r = detail.request;
  const a = detail.approval;
  const linked = detail.linkedRequests;
  const isMine = r.employeeId === user.employeeId;
  // Per-Diem is the only line split per traveller — everything else is a
  // single receipt or a flat amount for the whole group. Inside-city, each
  // person's own cut comes from their own "office meal taken?" answer —
  // never a team total divided evenly. Outside-city Per-Diem doesn't vary by
  // traveller, so it's still shared out evenly there.
  const isTeam = r.travelType === 'team' && r.teamMembers.length > 0;
  const ownPerDiem = (mealTaken: boolean) =>
    r.scope === 'inside'
      ? insidePerTravellerAmount(policy, r.workingHours, mealTaken)
      : r.teamSize > 0
        ? money((r.perDiemAmount + r.lunchAllowance) / r.teamSize)
        : 0;
  const requesterPerDiem = ownPerDiem(
    r.dualWorkstation ? true : r.officeMealTaken,
  );
  const teamPerDiemBreakdown =
    isTeam && (r.perDiemAmount > 0 || r.lunchAllowance > 0);
  const perDiemBreakdownLabel =
    r.perDiemAmount > 0
      ? `Per-Diem${r.perDiemDays > 1 ? ` · ${r.perDiemDays} days` : ''}`
      : 'Lunch allowance';
  const perDiemBreakdownTotal =
    r.perDiemAmount > 0 ? r.perDiemAmount : r.lunchAllowance;
  // Company-arranged costs are logged per traveller — the requester's own
  // figure plus whatever each team member cost, since one person can differ
  // from the rest (an extra night, say).
  const companyTransportTotal =
    (r.companyTransportAmount || 0) +
    r.teamMembers.reduce((s, m) => s + (m.companyTransportAmount || 0), 0);
  const companyAccommodationTotal =
    (r.companyAccommodationAmount || 0) +
    r.teamMembers.reduce((s, m) => s + (m.companyAccommodationAmount || 0), 0);
  // Rent-a-car and Flight are trips too, so their cost is already folded
  // into Transportation — listing them again here would look charged twice.
  const lines: [string, number][] = [
    ['Transportation (TA)', r.taAmount],
    ...(isTeam
      ? []
      : [
          [
            `Per-Diem${r.perDiemDays > 1 ? ` · ${r.perDiemDays} days` : ''}`,
            r.perDiemAmount,
          ] as [string, number],
          ['Lunch allowance', r.lunchAllowance] as [string, number],
        ]),
    ['Accommodation', r.accommodationAmount],
    ['Other', r.otherAmount],
    ['Company transportation (arranged)', companyTransportTotal],
    ['Company accommodation (arranged)', companyAccommodationTotal],
  ];
  // What the company already paid directly is real trip cost, so it belongs
  // in the total for the record — but it was never owed to the employee, so
  // it must never touch what Finance actually pays out.
  const displayTotalClaim =
    r.totalClaim + companyTransportTotal + companyAccommodationTotal;

  // The server decides which advance step this person may take — the
  // Department Head is derived from the requester's line-manager chain, so it
  // is not something the client can work out from roles.
  const advanceStep = detail.advanceStep
    ? {
        mode: (detail.advanceStep.action === 'settle'
          ? 'settle'
          : 'approve') as 'settle' | 'approve',
        label: detail.advanceStep.label,
        action: detail.advanceStep.action,
      }
    : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <button
            onClick={() => router.back()}
            className="rounded-lg p-2 text-muted-foreground hover:bg-accent"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-mono text-base font-bold sm:text-lg">
                {r.requestId}
              </h1>
              <StatusBadge status={r.status} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {r.employeeName} · Band {r.band} · {r.department} · submitted{' '}
              {r.submittedAt ? new Date(r.submittedAt).toLocaleString() : '—'}
            </p>
          </div>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          {detail.canEdit && (
            <Button
              variant="outline"
              className="flex-1 sm:flex-none"
              onClick={() => router.push(`/new-request?edit=${r.requestId}`)}
            >
              <Pencil size={16} /> Edit &amp; resubmit
            </Button>
          )}
          {detail.canAct &&
            ['payment_processing', 'payment_disputed'].includes(r.status) && (
              <Button
                className="flex-1 sm:flex-none"
                onClick={() => setPaying(true)}
              >
                <Banknote size={16} /> Mark paid
              </Button>
            )}
        </div>
      </div>

      <Card>
        <ProgressBar status={r.status} />
        <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3">
          {TRACK_STAGES.map((stage) => {
            const status = a?.[
              `${stage.column.toLowerCase()}Status` as keyof ApprovalRow
            ] as string | undefined;
            const by = a?.[
              `${stage.column.toLowerCase()}By` as keyof ApprovalRow
            ] as string | undefined;
            const at = a?.[
              `${stage.column.toLowerCase()}At` as keyof ApprovalRow
            ] as string | undefined;
            const done = ['Approved', 'Paid'].includes(status || '');
            const current = r.status === stage.key;
            const blocked = [
              'Rejected',
              'Returned',
              'Documents Requested',
            ].includes(status || '');
            return (
              <div
                key={stage.key}
                className={`rounded-xl border p-3 ${
                  blocked
                    ? 'border-rose-200 bg-rose-50'
                    : current
                      ? 'border-primary/30 bg-primary/5'
                      : done
                        ? 'border-emerald-200 bg-emerald-50'
                        : 'bg-muted'
                }`}
              >
                <div className="flex items-center gap-2">
                  {blocked ? (
                    <X size={14} className="text-rose-600" />
                  ) : done ? (
                    <Check size={14} className="text-emerald-600" />
                  ) : current ? (
                    <Clock size={14} className="text-primary" />
                  ) : (
                    <CircleDot size={14} className="text-muted-foreground" />
                  )}
                  <p
                    className={`text-xs font-bold ${blocked ? 'text-rose-700' : current ? 'text-primary' : done ? 'text-emerald-700' : 'text-muted-foreground'}`}
                  >
                    {stage.label}
                  </p>
                </div>
                <p className="mt-1.5 text-xs font-semibold text-muted-foreground">
                  {status || 'Not started'}
                </p>
                {by && (
                  <p className="text-xs leading-snug text-muted-foreground">
                    {by.replace(/<.*>/, '').trim()}
                  </p>
                )}
                {at && (
                  <p className="text-xs text-muted-foreground">
                    {new Date(at).toLocaleString()}
                  </p>
                )}
              </div>
            );
          })}
        </div>
        {r.status === 'rejected' && (
          <div className="mt-4">
            <Notice
              tone="error"
              items={[`Rejected — ${lastRemark(a) || 'see remarks'}`]}
            />
          </div>
        )}
        {r.status === 'returned' && (
          <div className="mt-4">
            <Notice
              tone="warn"
              items={[
                `Returned for correction — ${lastRemark(a) || 'see remarks'}`,
              ]}
            />
          </div>
        )}
        {r.approvedAmount > 0 && (
          <div className="mt-4">
            <Notice
              tone="warn"
              items={[
                `Approved at ${currency} ${r.approvedAmount} instead of the ${currency} ${r.totalClaim} claimed` +
                  `${r.approvedAmountBy ? ` by ${r.approvedAmountBy.replace(/<.*>/, '').trim()}` : ''}` +
                  `${r.approvedAmountNote ? ` — ${r.approvedAmountNote}` : ''}`,
              ]}
            />
          </div>
        )}
        {r.status === 'payment_disputed' && (
          <div className="mt-4">
            <Notice
              tone="error"
              items={[
                `${r.employeeName} says this payment never arrived${r.paymentAckNote ? ` — ${r.paymentAckNote}` : ''}. Finance is looking into it.`,
              ]}
            />
          </div>
        )}

        {/* Only the person who claimed it can say whether the money turned up,
            and until they do they cannot raise another claim. */}
        {isMine && r.status === 'paid' && !r.paymentAck && (
          <div className="mt-4 rounded-2xl border border-indigo-200 bg-indigo-50 p-4 sm:p-5">
            <p className="text-sm font-bold text-indigo-900">
              Did you get the money?
            </p>
            <p className="mt-1 text-sm leading-relaxed text-indigo-800">
              Finance paid{' '}
              <Money
                value={r.paidAmount || r.finalPayable}
                currency={currency}
              />{' '}
              on {r.paymentDate || '—'}
              {r.transactionId ? ` (ref ${r.transactionId})` : ''}. Tell us
              whether it reached you — you cannot raise a new claim until this
              one is answered.
            </p>
            {ackError && (
              <p className="mt-2 text-sm font-medium text-rose-700">
                {ackError}
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                disabled={acking}
                onClick={async () => {
                  setAcking(true);
                  setAckError('');
                  try {
                    await api.acknowledge(r.requestId, true);
                    await load();
                    onChanged();
                  } catch (err) {
                    setAckError((err as Error).message);
                  } finally {
                    setAcking(false);
                  }
                }}
              >
                <Check size={16} /> Yes, I received it
              </Button>
              <Button
                variant="outline"
                disabled={acking}
                onClick={() => setDisputing(true)}
              >
                <X size={16} /> No, it never arrived
              </Button>
            </div>
          </div>
        )}

        {isMine && r.paymentAck === 'received' && (
          <div className="mt-4">
            <Notice
              tone="info"
              items={['You confirmed this payment was received.']}
            />
          </div>
        )}
      </Card>

      {disputing && (
        <Modal
          title="The payment never arrived"
          onClose={() => setDisputing(false)}
        >
          <p className="text-sm leading-relaxed text-muted-foreground">
            Finance will re-check the transfer. Tell them what you can see — the
            account it should have gone to, and whether anything came through at
            all.
          </p>
          <Field label="What happened?" required>
            <textarea
              className="min-h-24 flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs"
              value={disputeNote}
              onChange={(e) => setDisputeNote(e.target.value)}
              placeholder="Nothing reached 01712345678 on 12 September. My bKash statement shows no credit that day."
            />
          </Field>
          {ackError && <Notice tone="error" items={[ackError]} />}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDisputing(false)}>
              Cancel
            </Button>
            <Button
              disabled={acking || !disputeNote.trim()}
              onClick={async () => {
                setAcking(true);
                setAckError('');
                try {
                  await api.acknowledge(r.requestId, false, disputeNote.trim());
                  setDisputing(false);
                  setDisputeNote('');
                  await load();
                  onChanged();
                } catch (err) {
                  setAckError((err as Error).message);
                } finally {
                  setAcking(false);
                }
              }}
            >
              Send back to Finance
            </Button>
          </div>
        </Modal>
      )}

      <div className="grid gap-4 sm:gap-5 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-5">
          <Card title="Travel">
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <Row
                label="Type"
                value={r.scope === 'inside' ? 'Inside city' : 'Outside city'}
              />
              {/* Outside-city travel is a route; inside-city is just a city. */}
              <Row
                label={r.scope === 'inside' ? 'City' : 'Route'}
                value={
                  r.scope === 'inside'
                    ? r.city
                    : [r.route, r.city].filter(Boolean).join(' — ') || r.city
                }
              />
              {/* Inside-city trips carry a kind as well as a name; show both
                  when both are there, and never an empty dash for the kind. */}
              <Row
                label="Destination"
                value={
                  [r.destinationType, r.destination]
                    .filter(Boolean)
                    .join(' — ') || '—'
                }
              />
              {/* The field is stored as "purpose" either way, but for a 10MS
                  Office visit it actually holds which office — label it that. */}
              <Row
                label={
                  policy.destinationTypes.find(
                    (d) => d.value === r.destinationType,
                  )?.needs === 'office'
                    ? 'Office name'
                    : 'Purpose'
                }
                value={r.purpose}
              />
              <Row
                label="Dates"
                value={
                  r.scope === 'inside'
                    ? r.fromDate
                    : `${r.fromDate} → ${r.toDate} (${r.tripDays} days)`
                }
              />
              <Row
                label="Claim type"
                value={
                  {
                    ta: 'TA only',
                    perdiem: 'Per-Diem only',
                    both: 'TA + Per-Diem',
                  }[r.claimType]
                }
              />
              {r.scope === 'inside' && r.workingHours > 0 && (
                <Row
                  label="Working hours"
                  value={`${r.startTime}–${r.endTime} · ${r.workingHours} h`}
                />
              )}
              {r.workedAt && <Row label="Worked at" value={r.workedAt} />}
              {r.scope === 'outside' && (
                <Row
                  label="Arrangement"
                  value={
                    r.arrangement === 'company'
                      ? 'Company arrangement'
                      : 'Self arrangement'
                  }
                />
              )}
              {r.transportMode && (
                <Row
                  label="Transport"
                  value={
                    r.transportMode +
                    (r.vehicleType ? ` · ${r.vehicleType}` : '')
                  }
                />
              )}
              {r.totalKM > 0 && (
                <Row
                  label="Distance"
                  value={`${r.travelFrom} → ${r.travelTo} · ${r.totalKM} km × ${r.fuelRate}`}
                />
              )}
              {r.dualWorkstation && (
                <Row label="Dual workstation" value={r.dualWorkstationType} />
              )}
              {r.hotelName && (
                <Row
                  label="Hotel"
                  value={`${r.hotelName} · ${r.checkIn} → ${r.checkOut}`}
                />
              )}
            </dl>
            {r.employeeNote && (
              <p className="mt-4 rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">
                <span className="font-semibold">Employee note: </span>
                {r.employeeNote}
              </p>
            )}
          </Card>

          {r.teamMembers.length > 0 && (
            <Card title={`Team (${r.teamMembers.length + 1} travellers)`}>
              <ul className="divide-y text-sm">
                <li className="flex flex-wrap justify-between gap-2 py-2">
                  <span>
                    <span className="font-medium">{r.employeeName}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {r.employeeId} · {r.designation}
                    </span>
                    <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                      Applicant
                    </span>
                  </span>
                  <span className="text-xs font-semibold text-muted-foreground">
                    Band {r.band} · {r.department}
                  </span>
                </li>
                {r.teamMembers.map((m) => (
                  <li
                    key={m.employeeId}
                    className="flex flex-wrap justify-between gap-2 py-2"
                  >
                    <span>
                      <span className="font-medium">{m.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {m.employeeId} · {m.designation}
                      </span>
                    </span>
                    <span className="text-xs font-semibold text-muted-foreground">
                      Band {m.band} · {m.department}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {r.legs.length > 0 && (
            <Card title="Trips claimed">
              <ul className="space-y-2 sm:hidden">
                {r.legs.map((l, i) => (
                  <li key={i} className="rounded-xl border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {l.travelFrom} → {l.travelTo}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {l.travelDate} · {l.mode}
                        </p>
                      </div>
                      <span className="shrink-0 text-sm font-bold">
                        <Money value={l.amount} currency={currency} />
                      </span>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="hidden overflow-x-auto sm:block">
                <table className="w-full text-sm">
                  <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="py-2 pr-3 font-semibold">Date</th>
                      <th className="py-2 pr-3 font-semibold">Mode</th>
                      <th className="py-2 pr-3 font-semibold">From → To</th>
                      <th className="py-2 text-right font-semibold">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {r.legs.map((l, i) => (
                      <tr key={i}>
                        <td className="py-2 pr-3 text-muted-foreground">
                          {l.travelDate}
                        </td>
                        <td className="py-2 pr-3 text-muted-foreground">
                          {l.mode}
                        </td>
                        <td className="py-2 pr-3 text-muted-foreground">
                          {l.travelFrom} → {l.travelTo}
                        </td>
                        <td className="py-2 text-right font-medium">
                          <Money value={l.amount} currency={currency} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {r.arrangement === 'company' && (
            <CompanyAmountsCard
              r={r}
              currency={currency}
              canEdit={user.roles.some((role) =>
                ['admin', 'hr'].includes(role),
              )}
              onSaved={(updated) =>
                setDetail((d) => (d ? { ...d, request: updated } : d))
              }
            />
          )}

          <Card
            title="Documents"
            subtitle={
              r.documentTypes.length ? r.documentTypes.join(' · ') : undefined
            }
          >
            {!r.documentLinks.length ? (
              <Empty title="No document links shared" />
            ) : (
              <ul className="space-y-2">
                {r.documentLinks.map((link, i) => (
                  <li key={i}>
                    <a
                      href={link}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition hover:border-primary/40 hover:bg-accent"
                    >
                      <LinkIcon
                        size={15}
                        className="shrink-0 text-muted-foreground"
                      />
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {link}
                      </span>
                      <ExternalLink
                        size={14}
                        className="shrink-0 text-primary"
                      />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card
            title="Approval trail"
            subtitle="One row per request — each desk keeps its own decision, remark and timestamp."
          >
            {!a ? (
              <Empty title="Nothing logged yet" />
            ) : (
              <>
                {/* Phones: a block per desk instead of a five-column table. */}
                <ul className="space-y-2 md:hidden">
                  {trailRows(a, r).map((t) => (
                    <li key={t.stage} className="rounded-xl border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold">{t.stage}</span>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
                            [
                              'Approved',
                              'Paid',
                              'Submitted',
                              'Settled',
                            ].includes(t.status)
                              ? 'bg-emerald-50 text-emerald-700'
                              : t.status === '—'
                                ? 'bg-muted text-muted-foreground'
                                : 'bg-amber-50 text-amber-700'
                          }`}
                        >
                          {t.status}
                        </span>
                      </div>
                      {t.by !== '—' && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t.by}
                        </p>
                      )}
                      {t.at !== '—' && (
                        <p className="text-xs text-muted-foreground">{t.at}</p>
                      )}
                      {t.remarks !== '—' && (
                        <p className="mt-1.5 rounded-lg bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">
                          {t.remarks}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>

                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full text-sm">
                    <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="py-2 pr-3 font-semibold">Stage</th>
                        <th className="py-2 pr-3 font-semibold">Status</th>
                        <th className="py-2 pr-3 font-semibold">By</th>
                        <th className="py-2 pr-3 font-semibold">When</th>
                        <th className="py-2 font-semibold">Remarks</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {trailRows(a, r).map((t) => (
                        <tr key={t.stage}>
                          <td className="py-2 pr-3 font-medium">{t.stage}</td>
                          <td className="py-2 pr-3 text-muted-foreground">
                            {t.status}
                          </td>
                          <td className="py-2 pr-3 text-muted-foreground">
                            {t.by}
                          </td>
                          <td className="py-2 pr-3 text-muted-foreground">
                            {t.at}
                          </td>
                          <td className="py-2 text-muted-foreground">
                            {t.remarks}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Card>
        </div>

        <aside className="min-w-0 space-y-4 lg:sticky lg:top-6 lg:self-start">
          <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
            <div className="border-b bg-muted px-5 py-3">
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Claim summary
              </p>
            </div>
            <div className="space-y-2 px-5 py-4 text-sm">
              {teamPerDiemBreakdown && (
                <div>
                  <span className="mb-1 block text-muted-foreground">
                    {perDiemBreakdownLabel}
                  </span>
                  <div className="space-y-1 border-l-2 pl-3">
                    <div className="flex justify-between gap-3 text-xs">
                      <span className="text-muted-foreground">
                        {r.employeeName}
                        {isMine ? ' (you)' : ''}
                      </span>
                      <span>
                        <Money value={requesterPerDiem} currency={currency} />
                      </span>
                    </div>
                    {r.teamMembers.map((m, i) => (
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
                      {perDiemBreakdownLabel} total
                    </span>
                    <span className="font-medium">
                      <Money
                        value={perDiemBreakdownTotal}
                        currency={currency}
                      />
                    </span>
                  </div>
                </div>
              )}
              {lines
                .filter(([, v]) => v > 0)
                .map(([label, value]) => (
                  <div key={label} className="flex justify-between">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-medium">
                      <Money value={value} currency={currency} />
                    </span>
                  </div>
                ))}
              <div className="flex justify-between border-t pt-3">
                <span className="font-semibold">Total claim</span>
                <span
                  className={`font-bold ${r.approvedAmount ? 'text-muted-foreground line-through' : ''}`}
                >
                  <Money value={displayTotalClaim} currency={currency} />
                </span>
              </div>
              {(companyTransportTotal > 0 || companyAccommodationTotal > 0) && (
                <p className="text-xs text-muted-foreground">
                  Includes{' '}
                  <Money
                    value={companyTransportTotal + companyAccommodationTotal}
                    currency={currency}
                  />{' '}
                  the company paid directly — not part of what&apos;s payable
                  below.
                </p>
              )}
              {/* Both figures stay on screen: the claim as filed, and what an
                  approver decided to pay instead. */}
              {r.approvedAmount > 0 && (
                <div className="flex justify-between">
                  <span className="font-semibold text-amber-700">
                    Approved amount
                  </span>
                  <span className="font-bold text-amber-700">
                    <Money value={r.approvedAmount} currency={currency} />
                  </span>
                </div>
              )}
              {r.advanceRequested > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    Advance adjustment
                  </span>
                  <span className="font-medium text-rose-600">
                    − <Money value={r.advanceRequested} currency={currency} />
                  </span>
                </div>
              )}
              <div className="flex justify-between border-t pt-2">
                <span className="font-semibold">Final payable</span>
                <span className="font-bold text-emerald-600">
                  <Money value={r.finalPayable} currency={currency} />
                </span>
              </div>
              {r.bkashNumber && r.payoutMethod !== 'bank' && (
                <div className="flex justify-between gap-3 border-t pt-2">
                  <span className="text-muted-foreground">
                    Pay to (bKash){linked.length ? ' — your own share' : ''}
                  </span>
                  <span className="font-mono font-semibold">
                    {r.bkashNumber}
                  </span>
                </div>
              )}
              {linked.length > 0 && (
                <div className="border-t pt-2">
                  <div className="flex justify-between">
                    <span className="font-semibold">Combined trip total</span>
                    <span className="font-bold">
                      <Money
                        value={
                          r.totalClaim +
                          linked.reduce((s, l) => s + l.totalClaim, 0)
                        }
                        currency={currency}
                      />
                    </span>
                  </div>
                  <div className="mt-1 flex justify-between">
                    <span className="text-muted-foreground">
                      Combined payable
                    </span>
                    <span className="font-semibold">
                      <Money
                        value={
                          r.finalPayable +
                          linked.reduce((s, l) => s + l.finalPayable, 0)
                        }
                        currency={currency}
                      />
                    </span>
                  </div>
                  <div className="mt-2 space-y-1.5 border-t pt-2">
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <span className="min-w-0 truncate text-muted-foreground">
                        {r.employeeName}
                        {isMine ? ' (you)' : ''}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="font-mono text-muted-foreground">
                          {r.bkashNumber || '—'}
                        </span>
                        <span className="font-semibold">
                          <Money value={r.finalPayable} currency={currency} />
                        </span>
                      </span>
                    </div>
                    {linked.map((l) => (
                      <div
                        key={l.requestId}
                        className="flex items-center justify-between gap-3 text-xs"
                      >
                        <span className="min-w-0 truncate text-muted-foreground">
                          {l.employeeName}
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span className="font-mono text-muted-foreground">
                            {l.bkashNumber || '—'}
                          </span>
                          <span className="font-semibold">
                            <Money value={l.finalPayable} currency={currency} />
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {r.advanceRequested > 0 && (
            <Card title="Advance">
              <dl className="space-y-2 text-sm">
                <Row
                  label="Requested"
                  value={`${currency} ${r.advanceRequested}`}
                />
                <Row
                  label="Approved"
                  value={
                    r.advanceApproved ? `${currency} ${r.advanceApproved}` : '—'
                  }
                />
                <Row
                  label="Status"
                  value={r.advanceStatus.replace(/_/g, ' ') || 'pending'}
                />
                <Row
                  label="Settlement due"
                  value={r.settlementDueDate || '—'}
                />
                {r.settledAt && (
                  <Row
                    label="Settled"
                    value={`${currency} ${r.settledAmount} on ${new Date(r.settledAt).toLocaleDateString()}`}
                  />
                )}
              </dl>
              {advanceStep && (
                <div className="mt-4 grid gap-2">
                  <Button onClick={() => setAdvanceAction(advanceStep.mode)}>
                    {advanceStep.mode === 'settle' ? (
                      <HandCoins size={16} />
                    ) : (
                      <Check size={16} />
                    )}{' '}
                    {advanceStep.label}
                  </Button>
                  {advanceStep.mode === 'approve' && (
                    <Button
                      variant="destructive"
                      onClick={() => setAdvanceAction('reject')}
                    >
                      <X size={16} /> Reject advance
                    </Button>
                  )}
                </div>
              )}
            </Card>
          )}

          {r.paidAmount > 0 && (
            <Card title="Payment">
              <dl className="space-y-2 text-sm">
                <Row label="Amount" value={`${currency} ${r.paidAmount}`} />
                <Row label="Mode" value={r.paymentMode} />
                <Row label="Transaction" value={r.transactionId} />
                <Row label="Date" value={r.paymentDate} />
                <Row
                  label="Processed by"
                  value={r.paidBy.replace(/<.*>/, '').trim()}
                />
              </dl>
            </Card>
          )}

          {r.policyNotes && (
            <Notice
              tone="info"
              title="Policy applied"
              items={r.policyNotes.split(' | ').filter(Boolean)}
            />
          )}

          {detail.canAct && (
            <Card
              title="Your decision"
              subtitle={
                r.status === 'payment_disputed'
                  ? 'The employee says this payment never arrived. Look into it, then record the payment again with a remark.'
                  : r.status === 'payment_processing'
                    ? 'Already approved — record the payment, or send it back if something is wrong.'
                    : `This request is at your desk as ${r.status.replace(/_/g, ' ')}.`
              }
            >
              <div className="grid gap-2">
                {['payment_processing', 'payment_disputed'].includes(
                  r.status,
                ) ? (
                  <Button onClick={() => setPaying(true)}>
                    <Banknote size={16} /> Mark paid
                  </Button>
                ) : (
                  <Button onClick={() => setAction('approve')}>
                    <Check size={16} /> Approve
                  </Button>
                )}
                <Button variant="outline" onClick={() => setAction('return')}>
                  <RotateCcw size={16} /> Return for correction
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setAction('request_docs')}
                >
                  <FileText size={16} /> Request more documents
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => setAction('reject')}
                >
                  <X size={16} /> Reject
                </Button>
              </div>
            </Card>
          )}
        </aside>
      </div>

      {action && (
        <ActionModal
          action={action}
          claimed={r.approvedAmount || r.totalClaim}
          currency={currency}
          requestId={r.requestId}
          onClose={() => setAction(null)}
          onDone={() => {
            setAction(null);
            load();
            onChanged();
          }}
        />
      )}

      {paying && (
        <PaymentModal
          requestId={r.requestId}
          needsRemark={r.status === 'payment_disputed'}
          amount={r.finalPayable}
          bkashNumber={r.bkashNumber}
          methods={policy.paymentMethods}
          currency={currency}
          onClose={() => setPaying(false)}
          onDone={() => {
            setPaying(false);
            load();
            onChanged();
          }}
        />
      )}

      {advanceAction && (
        <AdvanceModal
          requestId={r.requestId}
          mode={advanceAction}
          action={advanceStep?.action || 'hr_approve'}
          currency={currency}
          requested={r.advanceRequested}
          approved={r.advanceApproved}
          limit={cfgNum(policy, 'ADVANCE_AUTO_LIMIT', 10000)}
          onClose={() => setAdvanceAction(null)}
          onDone={() => {
            setAdvanceAction(null);
            load();
            onChanged();
          }}
        />
      )}
    </div>
  );
}

/** The approval trail as plain rows, used by both the phone and table views. */
function trailRows(a: ApprovalRow, r: Detail['request']) {
  const person = (v?: string) =>
    String(v || '')
      .replace(/<.*>/, '')
      .trim() || '—';
  const when = (v?: string) => (v ? new Date(v).toLocaleString() : '—');
  const rows = [
    {
      stage: 'Submitted',
      status: a.submittedAt ? 'Submitted' : '—',
      by: r.employeeName,
      at: when(a.submittedAt),
      remarks: a.submittedRemarks || '—',
    },
    ...TRACK_STAGES.map((s) => {
      const k = s.column.toLowerCase();
      return {
        stage: s.label,
        status: (a[`${k}Status` as keyof ApprovalRow] as string) || '—',
        by: person(a[`${k}By` as keyof ApprovalRow] as string),
        at: when(a[`${k}At` as keyof ApprovalRow] as string),
        remarks: (a[`${k}Remarks` as keyof ApprovalRow] as string) || '—',
      };
    }),
  ];
  if (r.advanceRequested > 0) {
    rows.push(
      {
        stage: 'Advance · HR',
        status: a.advanceHRStatus || '—',
        by: person(a.advanceHRBy),
        at: when(a.advanceHRAt),
        remarks: '—',
      },
      {
        stage: 'Advance · Dept Head',
        status: a.advanceDeptHeadStatus || '—',
        by: person(a.advanceDeptHeadBy),
        at: when(a.advanceDeptHeadAt),
        remarks: '—',
      },
    );
  }
  return rows;
}

function lastRemark(a: ApprovalRow | null): string {
  if (!a) return '';
  return (
    a.paymentRemarks ||
    a.financeRemarks ||
    a.adminRemarks ||
    a.managerRemarks ||
    ''
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm">{value}</dd>
    </div>
  );
}
