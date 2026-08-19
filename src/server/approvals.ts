/**
 * Writing to the Approvals sheet on submit/resubmit — split out of the old
 * single Express app.ts so both the create and update request routes can
 * share it.
 */

import type { Session } from './auth';
import { upsertApproval, type loadPolicy } from './store';
import type { RequestRecord } from '../shared/types';

export async function onSubmitted(
  record: RequestRecord,
  session: Session,
  policy: Awaited<ReturnType<typeof loadPolicy>>,
  resubmit = false,
): Promise<void> {
  await upsertApproval(
    record.requestId,
    record.employeeName,
    [{ group: 'Manager', status: 'Pending', by: '', remarks: '' }],
    {
      currentStage: 'manager_review',
      lastAction: resubmit
        ? `Resubmitted by ${session.name}`
        : `Submitted by ${session.name}`,
    },
  );
}
