'use client';

import { useSession } from '@/hooks/use-session';
import { RequestList } from '@/features/requests/request-list';

export default function DeskAllPage() {
  const { user } = useSession();
  if (!user) return null;

  const isAdmin = user.roles.some((r) => ['admin', 'hr'].includes(r));
  const isFinance = user.roles.includes('finance');

  return (
    <RequestList
      // Admin / Finance / HR get the full register including their own
      // claims; a line manager still only sees their reports'.
      scope={isAdmin || isFinance ? 'everything' : 'desk'}
      showFilters
      title="All Claims"
      subtitle="Every claim you oversee, newest first. Filter by department, stage or person."
    />
  );
}
