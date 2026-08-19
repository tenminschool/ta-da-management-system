import { NextResponse } from 'next/server';
import { withRoute, requireSession, type RouteParams } from '@/server/http';
import { hasRole } from '@/server/auth';
import { readTab, updateRow } from '@/server/sheets';
import {
  deptHeadIdFor,
  fromRequest,
  loadPolicy,
  nowISO,
  toRequest,
  upsertApproval,
} from '@/server/store';
import { cfgNum } from '@/shared/policy';
import type { RequestRecord } from '@/shared/types';

export const POST = withRoute(
  async (request: Request, { params }: RouteParams<'id'>) => {
    const session = requireSession(request);
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const action = String(body?.action || '');
    const rows = await readTab('Requests');
    const row = rows.find((r) => r.request_id === id);
    if (!row) {
      return NextResponse.json(
        { error: 'Request not found.' },
        { status: 404 },
      );
    }
    const record = toRequest(row);
    if (record.advanceRequested <= 0) {
      return NextResponse.json(
        { error: 'This request has no advance.' },
        { status: 400 },
      );
    }

    const policy = await loadPolicy();
    const deptHead = await deptHeadIdFor(record.employeeId);
    // Anything over the limit always takes a second approval after HR. That is
    // the department head when the employee has one; when nobody sits above the
    // line manager, Administration clears it instead — so it can never stall.
    const needsDeptHead =
      record.advanceRequested > cfgNum(policy, 'ADVANCE_AUTO_LIMIT', 10000);
    const stamp = `${session.name} <${session.email}>`;
    const updated: RequestRecord = { ...record, updatedAt: nowISO() };
    let group: 'AdvanceHR' | 'AdvanceDeptHead' | undefined;
    let stageStatus = '';

    if (action === 'hr_approve') {
      // Administration can do anything HR can, so it stands in here too.
      if (!hasRole(session, 'hr', 'admin')) {
        return NextResponse.json(
          { error: 'Only HR or Administration can approve at this step.' },
          { status: 403 },
        );
      }
      updated.advanceApproved = Number(body?.amount) || record.advanceRequested;
      updated.advanceStatus = needsDeptHead ? 'awaiting_dept_head' : 'approved';
      group = 'AdvanceHR';
      stageStatus = 'Approved';
    } else if (action === 'dept_head_approve') {
      if (session.employeeId !== deptHead && !hasRole(session, 'admin')) {
        return NextResponse.json(
          {
            error:
              "Only this employee's Department Head or Administration can approve at this step.",
          },
          { status: 403 },
        );
      }
      updated.advanceApproved =
        Number(body?.amount) ||
        record.advanceApproved ||
        record.advanceRequested;
      updated.advanceStatus = 'approved';
      group = 'AdvanceDeptHead';
      stageStatus = 'Approved';
    } else if (action === 'reject') {
      const isHead = session.employeeId === deptHead;
      if (!hasRole(session, 'hr', 'finance', 'admin') && !isHead) {
        return NextResponse.json(
          { error: 'You cannot reject this advance.' },
          { status: 403 },
        );
      }
      updated.advanceStatus = 'rejected';
      group =
        record.advanceStatus === 'awaiting_dept_head'
          ? 'AdvanceDeptHead'
          : 'AdvanceHR';
      stageStatus = 'Rejected';
    } else if (action === 'settle') {
      const settled = Number(body?.settledAmount);
      if (!Number.isFinite(settled)) {
        return NextResponse.json(
          { error: 'Enter the settled amount.' },
          { status: 400 },
        );
      }
      updated.settledAmount = settled;
      updated.settledAt = nowISO();
      updated.advanceStatus = 'settled';
      // Settling closes out a request that was parked in "paid".
      if (record.status === 'paid') {
        updated.status = 'completed';
        updated.completedAt = nowISO();
      }
      stageStatus = 'Settled';
    } else {
      return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    }

    await updateRow('Requests', row._row, fromRequest(updated));
    await upsertApproval(
      record.requestId,
      record.employeeName,
      group ? [{ group, status: stageStatus, by: stamp }] : [],
      {
        currentStage: updated.status,
        lastAction: `Advance ${stageStatus.toLowerCase()} by ${session.name}`,
      },
    );

    return NextResponse.json({ request: updated });
  },
);
