'use client';

import { SOURCE_PLATFORM } from '@/lib/api';
import { auth, LOGIN_PATH } from '@/lib/auth';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function redirectToLogin() {
  window.location.href = LOGIN_PATH;
}

export async function apiRequest<T>(
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const accessToken = await auth.getAccessToken();
  if (!accessToken) {
    redirectToLogin();
    throw new ApiError('Unauthorized', 401);
  }

  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${accessToken}`);
  if (SOURCE_PLATFORM) headers.set('X-TENMS-SOURCE-PLATFORM', SOURCE_PLATFORM);
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, { ...init, headers });
  if (res.status === 401) {
    redirectToLogin();
    throw new ApiError('Unauthorized', 401);
  }

  const text = await res.text();
  const body = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const message =
      body?.error?.message ||
      body?.message ||
      `Request failed with status ${res.status}`;
    throw new ApiError(message, res.status);
  }

  return body as T;
}
