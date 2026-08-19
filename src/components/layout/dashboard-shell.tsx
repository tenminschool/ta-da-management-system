'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { AppSidebar } from '@/components/layout/sidebar/app-sidebar';
import { SidebarProvider } from '@/components/layout/sidebar/sidebar-primitives';
import { FullBleedContext } from './full-bleed-context';
import { Header } from './header';

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [fullBleed, setFullBleed] = useState(false);

  return (
    <SidebarProvider className="h-svh flex-col overflow-hidden">
      <Header />
      <div className="flex min-h-0 flex-1">
        <AppSidebar />
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="mr-4 mb-4 ml-2 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-background shadow-sm">
            <div
              className={cn(
                'scrollbar-hide flex min-h-0 flex-1 flex-col',
                fullBleed ? 'overflow-hidden' : 'overflow-y-auto',
              )}
            >
              <div
                className={cn(
                  'flex min-h-0 w-full min-w-0 flex-1 flex-col',
                  fullBleed ? 'h-full' : 'p-6',
                )}
              >
                <FullBleedContext.Provider value={setFullBleed}>
                  {children}
                </FullBleedContext.Provider>
              </div>
            </div>
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
