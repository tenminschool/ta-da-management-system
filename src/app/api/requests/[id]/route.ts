import { NextResponse } from 'next/server';
import { withRoute, requireSession, type RouteParams } from '@/server/http';
import { readTab, readTabs, updateRow } from '@/server/sheets';
import {
  fromRequest,
  loadPolicy,
  nowISO,
  toApprovalRow,
  toRequest,
} from '@/server/store';
import { computeRequest } from '@/shared/policy';
import {
  advanceStepFor,
  awaitingAcknowledgement,
  buildRecord,
  canActOn,
  canView,
  currentSession,
  normaliseDraft,
} from '@/server/requests';
import { onSubmitted } from '@/server/approvals';
import type { RequestRecord } from '@/shared/types';

export const GET = withRoute(
  async (request: Request, { params }: RouteParams<'id'>) => {
    const session = requireSession(request);
    const { id } = await params;
    const tabs = await readTabs(['Requests', 'Approvals']);
    const row = tabs.Requests.find((r) => r.request_id === id);
    if (!row) {
      return NextResponse.json(
        { error: 'Request not found.' },
        { status: 404 },
      );
    }
    const record = toRequest(row);
    if (!canView(session, record)) {
      return NextResponse.json(
        { error: 'You do not have access to this request.' },
        { status: 403 },
      );
    }
    const approvalRow = tabs.Approvals.find(
      (a) => a.request_id === record.requestId,
    );

    // A team claim's linked children carry the rest of the trip's cost — the
    // main record alone only shows the requester's own share. Surfaced here so
    // the detail page can show what the whole trip actually adds up to.
    const linkedRequests = tabs.Requests.filter(
      (r) => r.linked_to === record.requestId,
    )
      .map(toRequest)
      .map((r) => ({
        requestId: r.requestId,
        employeeName: r.employeeName,
        bkashNumber: r.bkashNumber,
        totalClaim: r.totalClaim,
        finalPayable: r.finalPayable,
        status: r.status,
      }));

    return NextResponse.json({
      request: record,
      approval: approvalRow ? toApprovalRow(approvalRow) : null,
      canAct: canActOn(session, record),
      canEdit:
        record.employeeId === session.employeeId &&
        ['draft', 'returned'].includes(record.status),
      advanceStep: await advanceStepFor(session, record),
      linkedRequests,
    });
  },
);

export const PUT = withRoute(
  async (request: Request, { params }: RouteParams<'id'>) => {
    const session = requireSession(request);
    const { id } = await params;
    const rows = await readTab('Requests');
    const row = rows.find((r) => r.request_id === id);
    if (!row) {
      return NextResponse.json(
        { error: 'Request not found.' },
        { status: 404 },
      );
    }
    const existing = toRequest(row);
    if (existing.employeeId !== session.employeeId) {
      return NextResponse.json(
        { error: 'You can only edit your own request.' },
        { status: 403 },
      );
    }
    if (!['draft', 'returned'].includes(existing.status)) {
      return NextResponse.json(
        {
          error: `A request under ${existing.status.replace(/_/g, ' ')} can no longer be edited.`,
        },
        { status: 400 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const policy = await loadPolicy();
    const draft = normaliseDraft({
      ...body?.draft,
      requestId: existing.requestId,
    });
    const submit = body?.submit !== false;
    if (submit) {
      const waiting = (
        await awaitingAcknowledgement(session.employeeId)
      ).filter((rid) => rid !== existing.requestId);
      if (waiting.length) {
        return NextResponse.json(
          {
            error: `Please finish ${waiting.join(', ')} first — open it and tell us whether the payment reached you.`,
            blockedBy: waiting,
          },
          { status: 400 },
        );
      }
    }
    // Read once and reused below, same as on create: buildRecord's fuel_rate has
    // to be priced against the same registered vehicle the amount used.
    const fresh = await currentSession(session);
    const computation = computeRequest(policy, draft, fresh);
    if (submit && computation.errors.length) {
      return NextResponse.json(
        { error: computation.errors[0], computation },
        { status: 400 },
      );
    }

    const updated: RequestRecord = buildRecord(
      draft,
      computation,
      fresh,
      policy,
      {
        ...existing,
        status: submit ? 'manager_review' : 'draft',
        submittedAt: submit ? nowISO() : existing.submittedAt,
      },
    );

    await updateRow('Requests', row._row, fromRequest(updated));
    if (submit)
      await onSubmitted(
        updated,
        session,
        policy,
        existing.status === 'returned',
      );

    return NextResponse.json({ request: updated, computation });
  },
);
