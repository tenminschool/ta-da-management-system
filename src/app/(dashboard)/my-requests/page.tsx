'use client';

import { useSearchParams } from 'next/navigation';
import { RequestList } from '@/features/requests/request-list';
import type { StatusGroup } from '@/shared/types';

export default function MyRequestsPage() {
  const searchParams = useSearchParams();
  const group = (searchParams.get('group') as StatusGroup | null) ?? undefined;

  return (
    <RequestList
      scope="mine"
      showEmployee={false}
      group={group}
      title="My Requests"
      subtitle="Every claim you have raised, with its live status."
    />
  );
}
