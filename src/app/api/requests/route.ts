import { NextResponse } from 'next/server';
import { withRoute, requireSession } from '@/server/http';
import { appendRow, readTabs, withSheetLock } from '@/server/sheets';
import {
  allEmployees,
  fromRequest,
  loadPolicy,
  nextRequestId,
  nowISO,
  toRequest,
} from '@/server/store';
import {
  cfgStr,
  computeRequest,
  money,
  teamPayoutSplit,
} from '@/shared/policy';
import type { RequestRecord } from '@/shared/types';
import {
  awaitingAcknowledgement,
  buildRecord,
  canActOn,
  canView,
  childFromMain,
  currentSession,
  ensureUniqueRequestId,
  normaliseDraft,
  summarise,
} from '@/server/requests';
import { onSubmitted } from '@/server/approvals';

/**
 * Request lists are split into two worlds so an approver never sees their own
 * claims mixed in with the ones they are deciding on:
 *   `mine*`  — claims the signed-in person raised
 *   `desk*`  — other people's claims their role is responsible for
 */
export const GET = withRoute(async (request) => {
  const session = requireSession(request);
  const tabs = await readTabs(['Requests', 'Approvals']);
  const all = tabs.Requests.map(toRequest);
  const me = session.employeeId;
  const myEmail = session.email.toLowerCase();
  const visible = all.filter((r) => canView(session, r));
  const scope = new URL(request.url).searchParams.get('scope') || 'all';

  // A team-child record's employeeId is the teammate it's paying, but it is
  // never "theirs" to see — canView already keeps it out of `visible` for
  // them, and this keeps it out of summary counts for the requester too.
  const isMine = (r: RequestRecord) => r.employeeId === me && !r.linkedTo;
  const settled = (r: RequestRecord) =>
    ['payment_processing', 'paid', 'payment_disputed', 'completed'].includes(
      r.status,
    );
  // Once a team claim has split into linked children, its main record is
  // carrying other people's money too — someone filing their own team trip
  // (a small Finance desk, say) still needs their own share in the very same
  // payout batch as their teammates', so it can't stay hidden the way a
  // solo claim of theirs correctly does.
  const hasChildren = new Set(all.map((r) => r.linkedTo).filter(Boolean));

  // Requests this user has personally decided on, read off the Approvals row.
  const actedOn = new Set(
    tabs.Approvals.filter((a) =>
      [
        'manager_by',
        'admin_by',
        'finance_by',
        'payment_by',
        'advance_hr_by',
        'advance_dept_head_by',
      ].some((c) =>
        String(a[c] || '')
          .toLowerCase()
          .includes(myEmail),
      ),
    ).map((a) => a.request_id),
  );

  const filtered = visible.filter((r) => {
    switch (scope) {
      // The oversight register: literally everything this person may see,
      // their own claims included, so Admin/Finance/HR get a complete list.
      case 'everything':
        return true;
      case 'mine':
        return isMine(r);
      case 'mine_advance':
        return isMine(r) && r.advanceRequested > 0;
      case 'mine_payments':
        return isMine(r) && settled(r);
      case 'pending':
        return canActOn(session, r);
      case 'processed':
        return !isMine(r) && actedOn.has(r.requestId);
      case 'desk':
        return !isMine(r);
      case 'desk_advance':
        return !isMine(r) && r.advanceRequested > 0;
      // Finance's own screen: what is waiting on their approval as well as
      // what is waiting to be paid.
      case 'desk_payments':
        return (
          (!isMine(r) || hasChildren.has(r.requestId)) &&
          (settled(r) ||
            ['finance_review', 'payment_disputed'].includes(r.status))
        );
      default:
        return true;
    }
  });

  const deskRows = visible.filter((r) => !isMine(r));
  const pending = deskRows.filter((r) => canActOn(session, r));

  // Whose desk each claim is sitting on, plus the last thing that happened to
  // it — so a register row explains itself without opening the claim.
  const approvalByRequest = new Map(
    tabs.Approvals.map((a) => [a.request_id, a]),
  );
  const WAITING: Record<string, string> = {
    manager_review: 'Line Manager',
    admin_review: 'Administration',
    finance_review: 'Finance',
    payment_processing: 'Finance — payment',
    payment_disputed: 'Finance — payment not received',
    paid: 'Employee — confirm receipt',
    returned: 'Employee — correction needed',
    draft: 'Employee — not submitted',
  };
  const decorate = (r: RequestRecord) => {
    const a = approvalByRequest.get(r.requestId);
    return {
      ...r,
      isMine: isMine(r),
      waitingOn: WAITING[r.status] || '',
      lastAction: a?.last_action || '',
      lastActionAt: a?.last_action_at || '',
    };
  };

  return NextResponse.json({
    requests: filtered
      // Newest first: submitted time when it exists, creation time otherwise.
      .sort((a, b) =>
        (b.submittedAt || b.createdAt || '').localeCompare(
          a.submittedAt || a.createdAt || '',
        ),
      )
      .map(decorate),
    // Personal cards always describe only the signed-in employee's own claims.
    summary: summarise(all.filter(isMine)),
    inbox: pending.length,
    desk: {
      pending: pending.length,
      pendingValue: pending.reduce((s, r) => s + r.finalPayable, 0),
      processed: deskRows.filter((r) => actedOn.has(r.requestId)).length,
      inFlight: deskRows.filter((r) =>
        ['manager_review', 'admin_review', 'finance_review'].includes(r.status),
      ).length,
      awaitingPayment: deskRows.filter((r) => r.status === 'payment_processing')
        .length,
      advancesOpen: deskRows.filter(
        (r) => r.advanceRequested > 0 && !r.settledAt,
      ).length,
      totalValue: deskRows.reduce((s, r) => s + r.totalClaim, 0),
      count: deskRows.length,
    },
  });
});

export const POST = withRoute(async (request) => {
  const session = requireSession(request);
  const body = await request.json().catch(() => ({}));
  const policy = await loadPolicy();
  const draft = normaliseDraft(body?.draft);
  const submit = body?.submit !== false;
  // Read once and reused below: buildRecord's fuel_rate has to be priced
  // against the same registered vehicle the amount itself was computed from.
  const fresh = await currentSession(session);
  const computation = computeRequest(policy, draft, fresh);

  if (submit) {
    const waiting = await awaitingAcknowledgement(session.employeeId);
    if (waiting.length) {
      return NextResponse.json(
        {
          error:
            `Please finish ${waiting.join(', ')} first — open it and tell us whether the payment reached you. ` +
            'A new claim can be raised once that is answered.',
          blockedBy: waiting,
        },
        { status: 400 },
      );
    }
  }

  if (submit && computation.errors.length) {
    return NextResponse.json(
      { error: computation.errors[0], computation },
      { status: 400 },
    );
  }

  const manager = (await allEmployees()).find(
    (e) => e.employeeId === session.lineManagerId,
  );
  const now = nowISO();

  // Allocating the request number and writing the row must be atomic: two
  // people submitting at the same instant would otherwise read the same
  // highest number and both be issued it.
  const prefix = cfgStr(policy, 'REQUEST_ID_PREFIX', 'TA');
  const written = await withSheetLock(async () => {
    const requestId = await nextRequestId(prefix);
    let built = buildRecord(draft, computation, fresh, policy, {
      requestId,
      createdAt: now,
      status: submit ? 'manager_review' : 'draft',
      managerId: manager?.employeeId || '',
      managerEmail: manager?.email || '',
      submittedAt: submit ? now : '',
    });

    // A submitted team claim splits into one payable line per traveller:
    // the main record keeps only the requester's own share, and a linked
    // child is created for each teammate with theirs. The split is computed
    // once, against the full-team totals, before the main record's own
    // finalPayable/totalClaim are reduced — the children's shares must not
    // be derived from an already-reduced figure.
    const split =
      submit && draft.travelType === 'team' && draft.teamMembers.length > 0
        ? teamPayoutSplit(built, policy)
        : null;
    if (split) {
      const requesterShare = split[0]?.amount ?? built.finalPayable;
      built = {
        ...built,
        finalPayable: money(requesterShare),
        totalClaim: money(requesterShare + built.advanceRequested),
      };
    }

    const rowNumber = await appendRow('Requests', fromRequest(built));

    // Each child's ID has to be allocated after the row before it is
    // actually written — nextRequestId reads the sheet fresh every time, so
    // computing them all up front would hand out the same number twice.
    if (split) {
      for (let i = 0; i < built.teamMembers.length; i++) {
        const share = split[i + 1]?.amount ?? 0;
        const childId = await nextRequestId(prefix);
        const child = childFromMain(
          built,
          built.teamMembers[i],
          share,
          childId,
          now,
        );
        await appendRow('Requests', fromRequest(child));
      }
    }

    return { built, rowNumber };
  });
  const record = await ensureUniqueRequestId(
    written.built,
    written.rowNumber,
    prefix,
  );

  if (submit) await onSubmitted(record, session, policy);

  return NextResponse.json({ request: record, computation });
});
