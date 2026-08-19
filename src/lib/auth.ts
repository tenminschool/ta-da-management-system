import { TenMSAuth } from '@tenminuteschool/auth-admin-react';

export const CLIENT_ID = process.env.NEXT_PUBLIC_TENMS_CLIENT_ID ?? '';

if (!CLIENT_ID && typeof window !== 'undefined') {
  console.warn(
    'NEXT_PUBLIC_TENMS_CLIENT_ID is not set — "Login with 10MS Admin" will not work until it is configured.',
  );
}

// TenMSAuth requires a non-empty clientId at construction time. Falling back
// to a placeholder here (instead of letting it throw) keeps the app
// rendering when the env var is unset — login attempts fail normally instead
// of crashing every page via the root Providers tree.
//
// redirectUri is omitted deliberately — the SDK falls back to
// `window.location.origin` on its own, which is what the popup flow needs
// (same-origin as the opener). NEXT_PUBLIC_TENMS_REDIRECT_URI only exists to
// pin a specific URI when that default isn't right.
export const auth = new TenMSAuth({
  clientId: CLIENT_ID || 'unconfigured',
  redirectUri: process.env.NEXT_PUBLIC_TENMS_REDIRECT_URI,
  storage: 'localStorage',
});

export const LOGIN_PATH = '/login';
export const POST_LOGIN_REDIRECT = '/dashboard';
