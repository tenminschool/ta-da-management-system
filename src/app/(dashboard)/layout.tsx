'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { DashboardShell } from '@/components/layout/dashboard-shell';
import { LoadingSpinner } from '@tenminuteschool/design-system';
import { useSession } from '@/hooks/use-session';
import { LOGIN_PATH } from '@/lib/auth';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { user, policy, booting } = useSession();

  useEffect(() => {
    if (!booting && !user) {
      router.replace(LOGIN_PATH);
    }
  }, [booting, user, router]);

  if (booting) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoadingSpinner size="md" message="Starting up…" />
      </div>
    );
  }
  if (!user) return null;
  if (!policy) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoadingSpinner size="md" message="Loading policy…" />
      </div>
    );
  }

  return <DashboardShell>{children}</DashboardShell>;
}
