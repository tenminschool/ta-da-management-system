'use client';

import { use } from 'react';
import { useSession } from '@/hooks/use-session';
import { RequestDetailPage } from '@/features/requests/request-detail';

export default function RequestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { user, policy } = useSession();
  if (!user || !policy) return null;
  return <RequestDetailPage requestId={id} user={user} policy={policy} />;
}
