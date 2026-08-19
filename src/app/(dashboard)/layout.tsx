'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { DashboardShell } from '@/components/layout/dashboard-shell';
import { LoadingSpinner } from '@tenminuteschool/design-system';
import { useAuth } from '@/hooks/use-auth';
import { LOGIN_PATH } from '@/lib/auth';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { user, hydrated } = useAuth();

  useEffect(() => {
    if (hydrated && !user) {
      router.replace(LOGIN_PATH);
    }
  }, [hydrated, user, router]);

  if (!hydrated || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoadingSpinner size="md" className="text-muted-foreground" />
      </div>
    );
  }

  return <DashboardShell>{children}</DashboardShell>;
}
