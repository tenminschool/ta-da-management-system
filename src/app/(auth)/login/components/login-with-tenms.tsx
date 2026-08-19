'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { LoginButton, useTenMSAuth } from '@tenminuteschool/auth-admin-react';
import { CLIENT_ID, POST_LOGIN_REDIRECT } from '@/lib/auth';

export function LoginWithTenMS() {
  const router = useRouter();
  const { auth, user, loading, refresh } = useTenMSAuth();

  useEffect(() => {
    if (!loading && user) {
      router.replace(POST_LOGIN_REDIRECT);
    }
  }, [loading, user, router]);

  if (loading || user) return null;

  if (!CLIENT_ID) {
    return (
      <p className="rounded-md border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
        This app needs a client ID from 10 Minute School before sign-in can be
        enabled. Reach out to get one set up.
      </p>
    );
  }

  return (
    <LoginButton
      clientId={CLIENT_ID}
      className="w-full"
      onSuccess={async (response) => {
        try {
          await auth.handleLoginSuccess(response);
          refresh();
          router.replace(POST_LOGIN_REDIRECT);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Sign-in failed.');
        }
      }}
      onError={(err) => {
        toast.error(err instanceof Error ? err.message : 'Sign-in failed.');
      }}
    />
  );
}
