'use client';

import { SWRConfig } from 'swr';
import { TenMSAuthProvider } from '@tenminuteschool/auth-admin-react';
import { Toaster } from '@tenminuteschool/design-system';
import { auth } from '@/lib/auth';
import { SessionProvider } from '@/hooks/use-session';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <TenMSAuthProvider auth={auth}>
      <SessionProvider>
        <SWRConfig
          value={{
            revalidateOnFocus: true,
            shouldRetryOnError: false,
          }}
        >
          {children}
          <Toaster richColors closeButton />
        </SWRConfig>
      </SessionProvider>
    </TenMSAuthProvider>
  );
}
