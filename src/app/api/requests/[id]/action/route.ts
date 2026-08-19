import { NextResponse } from 'next/server';
import { withRoute, requireSession, type RouteParams } from '@/server/http';
import { readTab, updateRow } from '@/server/sheets';
import {
  fromRequest,
  nowISO,
  STAGE_COLUMN,
  toRequest,
  upsertApproval,
} from '@/server/store';
import { money } from '@/shared/policy';
import { canActOn, NEXT_STATUS } from '@/server/requests';
import type { RequestRecord, Status } from '@/shared/types';

export const POST = withRoute(
  async (request: Request, { params }: RouteParams<'id'>) => {
    const session = requireSession(request);
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const action = String(body?.action || '');
    const remarks = String(body?.remarks || '');
    const rows = await readTab('Requests');
    const row = rows.find((r) => r.request_id === id);
    if (!row) {
      return NextResponse.json(
        { error: 'Request not found.' },
        { status: 404 },
      );
    }
    const record = toRequest(row);
    if (!canActOn(session, record)) {
      return NextResponse.json(
        { error: 'This request is not at your desk right now.' },
        { status: 403 },
      );
    }
    if (!['approve', 'reject', 'return', 'request_docs'].includes(action)) {
      return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    }
    // Payment is a Finance stage too, so a second Finance user could otherwise
    // "approve" an already-approved claim and overwrite the payment column with
    // a meaningless entry. Releasing money happens through /payment only.
    if (record.status === 'payment_processing' && action === 'approve') {
      return NextResponse.json(
        {
          error:
            'This claim is already approved and waiting for payment. Use “Mark paid” to release it.',
        },
        { status: 400 },
      );
    }
    if (action !== 'approve' && !remarks.trim()) {
      return NextResponse.json(
        { error: 'Please add a remark explaining the decision.' },
        { status: 400 },
      );
    }

    const stage = record.status;
    const group = STAGE_COLUMN[stage];

    let next: Status = record.status;
    let stageStatus = '';

    // An approver may pay something other than what was claimed. It never edits
    // the employee's application — the claim stands as filed and the approved
    // figure sits beside it, so everyone downstream can see both.
    let approved = {
      approvedAmount: record.approvedAmount,
      approvedAmountBy: record.approvedAmountBy,
      approvedAmountAt: record.approvedAmountAt,
      approvedAmountNote: record.approvedAmountNote,
    };
    if (
      action === 'approve' &&
      body?.approvedAmount !== undefined &&
      body?.approvedAmount !== null
    ) {
      const amount = Number(body.approvedAmount);
      if (!Number.isFinite(amount) || amount < 0) {
        return NextResponse.json(
          { error: 'Enter a valid approved amount.' },
          { status: 400 },
        );
      }
      const current = record.approvedAmount || record.totalClaim;
      if (amount !== current) {
        if (!remarks.trim()) {
          return NextResponse.json(
            { error: 'Add a note explaining why the amount was changed.' },
            { status: 400 },
          );
        }
        approved = {
          approvedAmount: amount,
          approvedAmountBy: `${session.name} <${session.email}>`,
          approvedAmountAt: nowISO(),
          approvedAmountNote: remarks.trim(),
        };
      }
    }

    if (action === 'approve') {
      next = NEXT_STATUS[stage] || record.status;
      stageStatus = 'Approved';
    } else if (action === 'reject') {
      next = 'rejected';
      stageStatus = 'Rejected';
    } else {
      // "return" and "request_docs" both hand the request back to the employee.
      next = 'returned';
      stageStatus =
        action === 'request_docs' ? 'Documents Requested' : 'Returned';
    }

    const updated: RequestRecord = {
      ...record,
      ...approved,
      status: next,
      updatedAt: nowISO(),
      // What Finance actually pays follows the approved figure once one is set.
      finalPayable: money(
        (approved.approvedAmount || record.totalClaim) -
          record.advanceRequested,
      ),
      advanceStatus:
        record.advanceRequested > 0 &&
        action === 'approve' &&
        stage === 'manager_review'
          ? 'manager_approved'
          : record.advanceStatus,
    };
    await updateRow('Requests', row._row, fromRequest(updated));

    // A team claim's linked children mirror the main record's status
    // automatically — one decision on the main request governs the whole
    // trip. Their own finalPayable/totalClaim (each traveller's own share,
    // set once at creation) is untouched; only status moves with them.
    const childRows = rows.filter((r) => r.linked_to === record.requestId);
    for (const childRow of childRows) {
      const child = toRequest(childRow);
      await updateRow(
        'Requests',
        childRow._row,
        fromRequest({ ...child, status: next, updatedAt: nowISO() }),
      );
    }

    // This desk's decision and the next desk's "Pending" go into the same row in
    // one write.
    const patches = [
      {
        group,
        status: stageStatus,
        by: `${session.name} <${session.email}>`,
        remarks,
      },
    ];
    if (action === 'approve' && next !== record.status && STAGE_COLUMN[next]) {
      patches.push({
        group: STAGE_COLUMN[next],
        status: 'Pending',
        by: '',
        remarks: '',
      });
    }
    await upsertApproval(record.requestId, record.employeeName, patches, {
      currentStage: next,
      lastAction: `${stageStatus} by ${session.name}`,
    });

    return NextResponse.json({ request: updated });
  },
);
