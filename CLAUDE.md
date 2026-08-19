# TA & Per-Diem Management System

Built on the org's Next.js admin template (Next.js 16, App Router, TypeScript, Tailwind v4, shadcn). This file is the template's own conventions doc, carried over as-is during the migration off Vite/Express — it will grow ta-da-specific sections (the Sheets/Drive backend, the policy engine, the self/desk workspace switcher) as those land.

## Stack

| Layer     | Choice                                                         |
| --------- | -------------------------------------------------------------- |
| Framework | Next.js 16 (App Router, Turbopack)                             |
| UI        | React 19, shadcn (radix-nova), Tailwind v4                     |
| Font      | Geist Sans / Mono                                              |
| Auth      | `@tenminuteschool/auth-admin-react` — localStorage, no cookies |
| Forms     | Zod 4                                                          |
| Data      | SWR + `apiRequest()` for authenticated calls                   |
| Toasts    | sonner                                                         |

## Quick start

```bash
cp .env.example .env.local
# Fill in NEXT_PUBLIC_API_PREFIX, NEXT_PUBLIC_DOMAIN, NEXT_PUBLIC_APP_NAME
pnpm install
pnpm dev
```

## Environment variables

```bash

NEXT_PUBLIC_APP_NAME=10MS APP
NEXT_PUBLIC_TENMS_CLIENT_ID=          # required — client ID for "Login with 10MS Admin"
NEXT_PUBLIC_TENMS_SOURCE_PLATFORM=admin

```

Backend base URL constructed in `src/lib/api.ts` (used by feature services added via `API_SERVICES`/`API_ROUTES` — see "API layer" below):

```
https://{NEXT_PUBLIC_API_PREFIX}api.10minuteschool{NEXT_PUBLIC_DOMAIN}
```

Auth itself does not use this base URL — `@tenminuteschool/auth-admin-react` talks to its own fixed OAuth backend (see "Auth architecture" below).

## Folder structure

```
src/
├── app/
│   ├── (auth)/                         # Unauthenticated routes (login)
│   │   ├── components/brand-panel.tsx  # Left-panel split-screen branding
│   │   ├── layout.tsx                  # Split-screen auth shell
│   │   └── login/
│   │       ├── components/login-with-tenms.tsx  # LoginButton + useTenMSAuth
│   │       └── page.tsx
│   ├── (dashboard)/                    # Protected routes
│   │   ├── dashboard/page.tsx
│   │   ├── error.tsx                   # Route-group error boundary
│   │   ├── loading.tsx                 # Route-group skeleton
│   │   └── layout.tsx                  # Client-side auth guard → DashboardShell
│   ├── layout.tsx                      # Root fonts, Providers
│   ├── globals.css
│   ├── not-found.tsx
│   └── page.tsx                        # Redirects → /dashboard
│
├── features/                           # One folder per domain feature
│   └── dashboard/dashboard.tsx
│   # Add: features/users/, features/products/, etc.
│
├── components/
│   ├── layout/
│   │   ├── dashboard-shell.tsx         # Header + rail + content card
│   │   ├── header.tsx                  # Top navbar (logo, env badge, page title, user)
│   │   ├── header-user.tsx             # Navbar account dropdown
│   │   ├── dark-rail-theme.ts          # RAIL_SURFACE_CLASS → .rail-surface
│   │   ├── full-bleed-context.tsx      # useFullBleedPage() — page owns the card
│   │   └── sidebar/
│   │       ├── sidebar-primitives.tsx  # shadcn sidebar fork (modes + hover-peek)
│   │       ├── app-sidebar.tsx         # Composed rail
│   │       ├── nav-main.tsx            # Nav groups, collapsibles, icon flyouts
│   │       └── sidebar-settings.tsx    # Rail footer: sidebar mode picker
│   ├── providers.tsx
│   └── logo.tsx
│
├── hooks/
│   ├── use-auth.ts                     # Thin wrapper over useTenMSAuth()
│   ├── use-embedded.ts                 # In an HQ iframe / ?source=hq
│   └── use-large.ts                    # lg breakpoint — desktop rail vs mobile sheet
│
├── lib/
│   ├── api.ts                          # API_SERVICES, API_ROUTES, apiUrl()
│   ├── api/client.ts                   # apiRequest() — Bearer via auth.getAccessToken()
│   ├── auth.ts                         # TenMSAuth instance, CLIENT_ID, LOGIN_PATH
│   ├── nav.ts                          # Sidebar nav items (single source of truth)
│   └── utils.ts                        # cn()
│
└── constants/index.ts                  # APP_NAME, ENV
```

### Why each folder

- **app/** — Next.js routing only. Pages are thin — delegate to `features/`.
- **features/** — All domain logic lives here. Each feature owns: UI components, API calls (SWR hooks), types, schemas.
- **components/** — Generic, domain-agnostic UI. `layout/` for the app shell; everything else comes from `@tenminuteschool/design-system`.
- **hooks/** — Client-side React hooks.
- **lib/** — Pure utilities and infrastructure (no React). `auth.ts` for the auth SDK instance; `api/` for HTTP client.
- **constants/** — Compile-time values read from `process.env`.

## Auth architecture

"Login with 10MS Admin" via `@tenminuteschool/auth-admin-react` — OAuth 2.0 + PKCE against 10 Minute School's own auth backend. Client-side only — no Server Actions, no httpOnly cookies.

| Layer        | File                       | Behavior                                                                       |
| ------------ | -------------------------- | ------------------------------------------------------------------------------ |
| SDK instance | `lib/auth.ts`              | `new TenMSAuth({ clientId, storage: 'localStorage' })` — singleton             |
| Session      | `components/providers.tsx` | `TenMSAuthProvider` wraps the app once; handles cross-app token handoff        |
| Route guard  | `(dashboard)/layout.tsx`   | `useAuth()` (`hydrated`/`user`); redirects to `/login` if missing              |
| API calls    | `lib/api/client.ts`        | Bearer from `auth.getAccessToken()` (auto-refreshes); 401 → redirects `/login` |

### Session provider

`TenMSAuthProvider` needs `"use client"`, so it's mounted inside `components/providers.tsx` (already a client component) rather than directly in the Server Component root layout. Read session state anywhere in the tree with `useTenMSAuth()` — or `useAuth()` in `hooks/use-auth.ts`, a thin wrapper kept for a stable `{ user, hydrated, logout, isLoggingOut }` shape across the app.

**Never**: call `auth.handleTokenHandoff()` yourself (the provider already calls it once, globally, on mount — a second call races it), or read session state via `auth.isLoggedIn()`/`auth.getUser()` inside a component instead of `useTenMSAuth()`/`useAuth()`.

### Login flow

1. `LoginWithTenMS` (`app/(auth)/login/components/login-with-tenms.tsx`) renders the SDK's `<LoginButton clientId={CLIENT_ID} />`
2. `onSuccess`: `await auth.handleLoginSuccess(response)` → `refresh()` → `router.replace('/dashboard')`

### Logout flow

1. `useAuth().logout()`: `await auth.logout()` (revokes token when this app owns the session) → `refresh()` → `window.location.href = '/login'`

## API layer

```ts
// Add a new service in src/lib/api.ts:
export const API_SERVICES = {
  auth: `${API_BASE}/auth/v1`,
  users: `${API_BASE}/users/v1`, // add more services
} as const;

export const API_ROUTES = {
  auth: { login: '/admin/login', logout: '/logout' },
  users: { list: '/users', create: '/users' },
} as const satisfies Record<ServiceName, Record<string, string>>;
```

### Client-side data fetching pattern

```ts
// features/users/api.ts
import useSWR from 'swr';
import { apiRequest } from '@/lib/api/client';
import { apiUrl } from '@/lib/api';

export function useUsers() {
  return useSWR('/users', () => apiRequest(apiUrl('users', 'list')));
}
```

## Layout shell

Ported from **10MS HQ** — top navbar plus a floating left rail, with the page in an inset card.

```
DashboardShell            h-svh, flex-col, overflow-hidden
├── Header                sticky h-14: mobile SidebarTrigger, logo + APP_NAME, page title, HeaderUser
└── row (flex-1)
    ├── AppSidebar        floating rail, fixed under the header (top-14)
    └── content card      rounded-xl border, scrolls inside itself
```

### Sidebar modes

`SidebarProvider` persists one of three modes in `localStorage` (`sidebar_mode`), default `hover`:

| Mode        | Behavior                                                                |
| ----------- | ----------------------------------------------------------------------- |
| `expanded`  | Pinned open — reserves real layout width                                |
| `collapsed` | Icon rail, no peek; groups open as hover flyouts, items get tooltips    |
| `hover`     | Icon rail that peeks open on hover (debounced) and overlays the content |

- `⌘/Ctrl + B` (or the navbar trigger) flips `expanded` ⇄ `hover`; all three are pickable from the rail's bottom **Sidebar** item (`sidebar-settings.tsx`).
- The account menu lives only in the navbar (`header-user.tsx`) — the rail carries nav plus its own display settings.
- Rail items have no focus ring; a focused item takes the accent surface instead.
- Below `lg` the rail is replaced by a Sheet drawer, opened by the navbar trigger.
- An open dropdown/popover inside the rail locks the peek open via `setPeekLocked` — pass it to `onOpenChange` for anything anchored in the rail.
- The rail is near-black in light mode via `.rail-surface` (`globals.css`); in dark mode it defers to the app's `--sidebar` tokens.

`sidebar-primitives.tsx` is a **fork** of the shadcn sidebar (modes instead of a boolean `open`, hover-peek, header offset) — edit it directly; do not re-add it via the shadcn CLI. Leaf primitives come from `@tenminuteschool/design-system`.

### Nav, titles, full-bleed pages

- `lib/nav.ts` — `NAV` (categories → items → optional `items` children) is the single source of truth; `getNavTitle(pathname)` feeds the header title. Its **Examples** section (`Menu 1/2/3` → `app/(dashboard)/menu-*/`, `features/placeholder/`) is dummy content — delete it with the first real feature.
- `useFullBleedPage()` (`layout/full-bleed-context.tsx`) drops the card's padding and inner scroll so a page can own them (tables, iframes).
- `useIsEmbedded()` hides the navbar account menu when the app runs inside 10MS HQ (`?source=hq` or an iframe) — the host provides its own.

## Adding a new feature

1. Create `src/features/<name>/` with:
   - `types.ts` — TypeScript types
   - `schema.ts` — Zod validation schemas
   - `api.ts` — SWR hooks + mutations
   - `components/` — Feature UI
   - `<name>.tsx` — Main page component
2. Add a route: `src/app/(dashboard)/<name>/page.tsx` → `import { NamePage } from '@/features/<name>/<name>'`
3. Add nav item to `NAV` in `src/lib/nav.ts`

## UI components

Import from `@tenminuteschool/design-system` (Button, Input, Dialog, DataTable, …). The only hand-maintained UI is the layout shell in `src/components/layout/` — notably the sidebar fork described above.

## Code conventions

- Server components by default — `'use client'` only when you need hooks/events
- No barrel `index.ts` re-exports
- Tailwind utilities only — no CSS modules
- `cn()` for conditional class merging
- Zod schemas in `features/<name>/schema.ts`
- All API routes in `lib/api.ts` — never hardcode URLs in components
