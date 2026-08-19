'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { getNavTitle } from '@/lib/nav';
import { Logo } from '@/components/logo';
import { HeaderUser } from '@/components/layout/header-user';
import { SidebarTrigger } from '@/components/layout/sidebar/sidebar-primitives';
import { useIsEmbedded } from '@/hooks/use-embedded';
import { APP_NAME } from '@/constants';

export function Header() {
  const pathname = usePathname();
  const title = getNavTitle(pathname);
  const isEmbedded = useIsEmbedded();

  return (
    <header className="sticky top-0 z-50 flex h-14 w-full shrink-0 items-center gap-3 bg-transparent px-4">
      {/* Desktop keeps the rail on screen; only the mobile Sheet needs a trigger. */}
      <SidebarTrigger className="-ml-1 lg:hidden" />

      <Link href="/dashboard" className="flex shrink-0 items-center gap-2.5">
        <Logo className="h-8 w-8" iconSize={15} />
        <span className="hidden text-sm font-semibold tracking-tight sm:inline">
          {APP_NAME}
        </span>
      </Link>

      <div
        aria-hidden
        className="hidden h-5 w-px shrink-0 bg-border sm:block"
      />

      <span className="truncate text-sm font-semibold tracking-tight text-muted-foreground">
        {title}
      </span>

      {/* Embedded in a host shell (10MS HQ), the host owns the account menu. */}
      {!isEmbedded && (
        <div className="ml-auto flex shrink-0 items-center">
          <HeaderUser />
        </div>
      )}
    </header>
  );
}
