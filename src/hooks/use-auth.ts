'use client';

import { useCallback, useState } from 'react';
import { useTenMSAuth } from '@tenminuteschool/auth-admin-react';
import { LOGIN_PATH } from '@/lib/auth';

export function useAuth() {
  const { user, loading, auth, refresh } = useTenMSAuth();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const logout = useCallback(async () => {
    setIsLoggingOut(true);
    await auth.logout().catch(() => {});
    refresh();
    window.location.href = LOGIN_PATH;
  }, [auth, refresh]);

  return { user, hydrated: !loading, logout, isLoggingOut };
}
