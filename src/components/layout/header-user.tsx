'use client';

import { ChevronsUpDown, LogOut, UserRound } from 'lucide-react';
import { useSession } from '@/hooks/use-session';
import { HOST_OWNS_SESSION } from '@/lib/embed';
import {
  Avatar,
  AvatarFallback,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  LoadingSpinner,
  Skeleton,
} from '@tenminuteschool/design-system';

function LogoutOverlay() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-100 flex items-center justify-center bg-background/85 backdrop-blur-md animate-in fade-in duration-200"
    >
      <div className="flex items-center gap-3 rounded-xl border bg-card px-5 py-4 shadow-lg animate-in zoom-in-95 duration-200">
        <LoadingSpinner size="sm" className="text-muted-foreground" />
        <span className="text-sm font-medium">Signing you out…</span>
      </div>
    </div>
  );
}

function HeaderUserSkeleton() {
  return (
    <div className="flex items-center gap-2 rounded-lg p-1">
      <Skeleton className="size-8 shrink-0 rounded-full" />
      <div className="hidden min-w-0 space-y-1.5 sm:block">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-2.5 w-32" />
      </div>
    </div>
  );
}

function AvatarGlyph() {
  return (
    <Avatar className="size-8">
      <AvatarFallback className="bg-muted text-muted-foreground">
        <UserRound className="size-4" />
      </AvatarFallback>
    </Avatar>
  );
}

export function HeaderUser() {
  const { user, booting, signOut, isLoggingOut } = useSession();

  if (isLoggingOut) {
    return (
      <>
        <HeaderUserSkeleton />
        <LogoutOverlay />
      </>
    );
  }

  if (booting || !user) return <HeaderUserSkeleton />;

  const subtitle = `Band ${user.band} · ${user.department}`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Open user menu"
          className="flex max-w-56 items-center gap-2 rounded-lg p-1 text-left outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent data-[state=open]:text-accent-foreground"
        >
          <AvatarGlyph />
          <div className="hidden min-w-0 flex-1 text-sm leading-tight sm:grid">
            <span className="truncate font-semibold">{user.name}</span>
            <span className="truncate text-xs text-muted-foreground">
              {subtitle}
            </span>
          </div>
          <ChevronsUpDown className="hidden size-4 shrink-0 text-muted-foreground sm:block" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="min-w-56 rounded-lg"
        side="bottom"
        align="end"
        sideOffset={4}
      >
        <DropdownMenuLabel className="p-0 font-normal">
          <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
            <AvatarGlyph />
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-semibold">{user.name}</span>
              <span className="truncate text-xs text-muted-foreground">
                {user.email}
              </span>
            </div>
          </div>
        </DropdownMenuLabel>
        {/* The host owns the session when this panel is embedded — signing
            out here would strand the two out of step. */}
        {!HOST_OWNS_SESSION && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => void signOut()}
            >
              <LogOut />
              Sign out
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
