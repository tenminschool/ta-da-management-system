'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useSession } from '@/hooks/use-session';
import { NewRequestPage } from '@/features/new-request/new-request';
import { toDraft } from '@/features/new-request/to-draft';
import type { RequestDraft } from '@/shared/types';
import { Notice, Spinner } from '@/components/ui';

export default function NewRequestRoute() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get('edit');
  const { user, policy } = useSession();

  const [editing, setEditing] = useState<
    { draft: RequestDraft; requestId: string } | null | undefined
  >(editId ? undefined : null);
  const [loadError, setLoadError] = useState('');

  const loadEditing = useCallback(async () => {
    if (!editId) return;
    try {
      const detail = await api.request(editId);
      setEditing({
        draft: toDraft(detail.request),
        requestId: detail.request.requestId,
      });
    } catch (err) {
      setLoadError((err as Error).message);
    }
  }, [editId]);
  useEffect(() => {
    queueMicrotask(loadEditing);
  }, [loadEditing]);

  if (!user || !policy) return null;
  if (loadError) return <Notice tone="error" items={[loadError]} />;
  if (editing === undefined)
    return <Spinner label="Loading the request to edit…" />;

  return (
    <NewRequestPage
      user={user}
      policy={policy}
      editing={editing}
      onDone={(requestId) => router.push(`/requests/${requestId}`)}
      onCancel={() => router.back()}
    />
  );
}
