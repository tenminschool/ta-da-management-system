import { NextResponse } from 'next/server';
import { withRoute, requireSession } from '@/server/http';
import { loadPolicy } from '@/server/store';
import { computeRequest, eligibleModes } from '@/shared/policy';
import { currentSession, normaliseDraft } from '@/server/requests';

export const POST = withRoute(async (request) => {
  const session = requireSession(request);
  const body = await request.json().catch(() => ({}));
  const policy = await loadPolicy();
  const draft = normaliseDraft(body?.draft);
  return NextResponse.json({
    computation: computeRequest(policy, draft, await currentSession(session)),
    modes: eligibleModes(policy, {
      band: session.band,
      gender: session.gender,
      scope: draft.scope,
      travelType: draft.travelType,
      teamSize: draft.travelType === 'team' ? draft.teamMembers.length + 1 : 1,
      teamGenders: draft.teamMembers.map((m) => m.gender),
      carSpecialApproval: draft.carSpecialApproval,
    }),
  });
});
