import type { NextConfig } from 'next';

// prod  → NEXT_PUBLIC_API_PREFIX=,        NEXT_PUBLIC_DOMAIN=.com
// stage → NEXT_PUBLIC_API_PREFIX=stage-,  NEXT_PUBLIC_DOMAIN=.net
// local → NEXT_PUBLIC_API_PREFIX=local-,  NEXT_PUBLIC_DOMAIN=.net
// API_BASE is constructed in src/lib/api.ts from these two NEXT_PUBLIC_ vars.

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
