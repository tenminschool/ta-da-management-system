'use client';

import { useSession } from '@/hooks/use-session';
import { ReportsPage } from '@/features/reports/reports';

export default function DeskPage() {
  const { user, policy } = useSession();
  if (!user || !policy) return null;
  return <ReportsPage policy={policy} user={user} />;
}
