'use client';

import { useSession } from '@/hooks/use-session';
import { AdvancesPage } from '@/features/advances/advances';

export default function MyAdvancePage() {
  const { policy } = useSession();
  if (!policy) return null;
  return <AdvancesPage policy={policy} scope="mine" />;
}
