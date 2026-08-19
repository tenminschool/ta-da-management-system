'use client';

/**
 * Sidebar primitives — a fork of the shadcn sidebar, extended with:
 *
 * - three persisted modes (`expanded` / `collapsed` / `hover`) instead of a boolean open state
 * - hover-to-peek (debounced, lockable by anchored popovers) for `hover` mode
 * - `useIsLarge()` (lg breakpoint) to pick between the desktop rail and the mobile Sheet
 * - a rail that hangs below the app header (`top-14`) instead of spanning the viewport
 *
 * Leaf primitives (Button, Input, Sheet, Skeleton, Tooltip, …) come from
 * `@tenminuteschool/design-system`; only the sidebar shell lives here.
 */

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { PanelLeftIcon } from 'lucide-react';

import {
  Button,
  Input,
  Separator,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Skeleton,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@tenminuteschool/design-system';
import { useIsLarge } from '@/hooks/use-large';
import { cn } from '@/lib/utils';

const SIDEBAR_MODE_STORAGE_KEY = 'sidebar_mode';
const SIDEBAR_WIDTH = '16rem';
const SIDEBAR_WIDTH_MOBILE = '18rem';
const SIDEBAR_WIDTH_ICON = '3rem';
const SIDEBAR_KEYBOARD_SHORTCUT = 'b';

/** Pinned open, pinned closed (icon rail, no peek), or icon rail that expands on hover. */
type SidebarMode = 'expanded' | 'collapsed' | 'hover';
const SIDEBAR_DEFAULT_MODE: SidebarMode = 'expanded';

type SidebarContextProps = {
  state: 'expanded' | 'collapsed';
  mode: SidebarMode;
  setMode: (mode: SidebarMode) => void;
  openMobile: boolean;
  setOpenMobile: (open: boolean) => void;
  isLarge: boolean;
  toggleSidebar: () => void;
  /** Temporarily "peeking" open on hover, without pinning (persisting) the mode. */
  isPeeking: boolean;
  requestPeek: () => void;
  requestUnpeek: () => void;
  /** Holds a peek open while an anchored popover is open. */
  setPeekLocked: (locked: boolean) => void;
};

const SIDEBAR_PEEK_ENTER_DELAY = 80;
const SIDEBAR_PEEK_LEAVE_DELAY = 100;

const SidebarContext = React.createContext<SidebarContextProps | null>(null);

function useSidebar() {
  const context = React.useContext(SidebarContext);
  if (!context) {
    throw new Error('useSidebar must be used within a SidebarProvider.');
  }

  return context;
}

function SidebarProvider({
  defaultMode = SIDEBAR_DEFAULT_MODE,
  mode: modeProp,
  onModeChange: setModeProp,
  className,
  style,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  defaultMode?: SidebarMode;
  mode?: SidebarMode;
  onModeChange?: (mode: SidebarMode) => void;
}) {
  const isLarge = useIsLarge();
  const [openMobile, setOpenMobile] = React.useState(false);

  const getInitialMode = (): SidebarMode => {
    if (typeof window === 'undefined') return defaultMode;

    const stored = window.localStorage.getItem(SIDEBAR_MODE_STORAGE_KEY);
    return stored === 'expanded' || stored === 'collapsed' || stored === 'hover'
      ? stored
      : defaultMode;
  };

  const [_mode, _setMode] = React.useState<SidebarMode>(getInitialMode);
  const mode = modeProp ?? _mode;
  const setMode = React.useCallback(
    (value: SidebarMode) => {
      if (setModeProp) {
        setModeProp(value);
      } else {
        _setMode(value);
      }

      window.localStorage.setItem(SIDEBAR_MODE_STORAGE_KEY, value);
    },
    [setModeProp],
  );

  const open = mode === 'expanded';

  // Quick toggle flips expanded<->hover; the explicit "collapsed" (no peek) mode is only chosen via the control menu.
  const toggleSidebar = React.useCallback(() => {
    if (!isLarge) return setOpenMobile((open) => !open);
    setMode(mode === 'expanded' ? 'hover' : 'expanded');
  }, [isLarge, mode, setMode, setOpenMobile]);

  // Debounced hover-to-peek — only active in 'hover' mode, doesn't touch the persisted mode.
  const [isPeeking, setIsPeeking] = React.useState(false);
  const peekEnterTimer = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const peekLeaveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  // Last real mouseenter/mouseleave, so a lock release can check if it's safe to collapse.
  const isHoveringRef = React.useRef(false);

  const clearPeekTimers = React.useCallback(() => {
    if (peekEnterTimer.current) {
      clearTimeout(peekEnterTimer.current);
      peekEnterTimer.current = null;
    }
    if (peekLeaveTimer.current) {
      clearTimeout(peekLeaveTimer.current);
      peekLeaveTimer.current = null;
    }
  }, []);

  const requestPeek = React.useCallback(() => {
    isHoveringRef.current = true;
    if (mode !== 'hover' || peekEnterTimer.current) return;
    if (peekLeaveTimer.current) {
      clearTimeout(peekLeaveTimer.current);
      peekLeaveTimer.current = null;
    }
    peekEnterTimer.current = setTimeout(() => {
      setIsPeeking(true);
      peekEnterTimer.current = null;
    }, SIDEBAR_PEEK_ENTER_DELAY);
  }, [mode]);

  const peekLockedRef = React.useRef(false);

  const requestUnpeek = React.useCallback(() => {
    isHoveringRef.current = false;
    if (peekEnterTimer.current) {
      clearTimeout(peekEnterTimer.current);
      peekEnterTimer.current = null;
    }
    if (peekLeaveTimer.current) return;
    peekLeaveTimer.current = setTimeout(() => {
      peekLeaveTimer.current = null;
      if (!peekLockedRef.current) setIsPeeking(false);
    }, SIDEBAR_PEEK_LEAVE_DELAY);
  }, []);

  const setPeekLocked = React.useCallback(
    (locked: boolean) => {
      peekLockedRef.current = locked;
      // Only re-check on release if the pointer has actually left by now.
      if (!locked && !isHoveringRef.current) requestUnpeek();
    },
    [requestUnpeek],
  );

  // Once mode leaves 'hover' (or moves off desktop), any pending/active peek is
  // no longer relevant. Reset during render (React's documented "adjust state
  // when a prop changes" pattern) rather than in an effect, which would trip
  // react-hooks/set-state-in-effect and cost an extra render.
  const peekAllowed = mode === 'hover' && isLarge;
  const [peekScope, setPeekScope] = React.useState(peekAllowed);
  if (peekScope !== peekAllowed) {
    setPeekScope(peekAllowed);
    setIsPeeking(false);
  }

  React.useEffect(() => {
    if (peekAllowed) return;
    clearPeekTimers();
  }, [peekAllowed, clearPeekTimers]);

  React.useEffect(() => clearPeekTimers, [clearPeekTimers]);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === SIDEBAR_KEYBOARD_SHORTCUT &&
        (event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault();
        toggleSidebar();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleSidebar]);

  // Peeking counts as visually "expanded" without touching the persisted mode.
  const state = open || isPeeking ? 'expanded' : 'collapsed';

  const contextValue = React.useMemo<SidebarContextProps>(
    () => ({
      state,
      mode,
      setMode,
      isLarge,
      openMobile,
      setOpenMobile,
      toggleSidebar,
      isPeeking,
      requestPeek,
      requestUnpeek,
      setPeekLocked,
    }),
    [
      state,
      mode,
      setMode,
      isLarge,
      openMobile,
      setOpenMobile,
      toggleSidebar,
      isPeeking,
      requestPeek,
      requestUnpeek,
      setPeekLocked,
    ],
  );

  return (
    <SidebarContext.Provider value={contextValue}>
      <TooltipProvider delayDuration={0}>
        <div
          data-slot="sidebar-wrapper"
          style={
            {
              '--sidebar-width': SIDEBAR_WIDTH,
              '--sidebar-width-icon': SIDEBAR_WIDTH_ICON,
              ...style,
            } as React.CSSProperties
          }
          className={cn(
            'group/sidebar-wrapper flex min-h-svh w-full has-data-[variant=inset]:bg-sidebar',
            className,
          )}
          {...props}
        >
          {children}
        </div>
      </TooltipProvider>
    </SidebarContext.Provider>
  );
}

function Sidebar({
  side = 'left',
  variant = 'sidebar',
  collapsible = 'offcanvas',
  className,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  side?: 'left' | 'right';
  variant?: 'sidebar' | 'floating' | 'inset';
  collapsible?: 'offcanvas' | 'icon' | 'none';
}) {
  const {
    isLarge,
    state,
    mode,
    isPeeking,
    openMobile,
    setOpenMobile,
    requestPeek,
    requestUnpeek,
  } = useSidebar();

  // Hover-to-peek only makes sense for a floating, icon-collapsible sidebar —
  // it's the one whose expanded state overlays content instead of pushing it.
  const canPeek = variant === 'floating' && collapsible === 'icon';
  const { onMouseEnter, onMouseLeave, ...restProps } = props;

  const containerRef = React.useRef<HTMLDivElement | null>(null);

  // Safety net for peek getting stuck open: a portaled popover
  React.useEffect(() => {
    if (!canPeek || !isPeeking) return;

    const handlePointerMove = (event: MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const inside =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;
      if (!inside) requestUnpeek();
    };

    window.addEventListener('mousemove', handlePointerMove);
    return () => window.removeEventListener('mousemove', handlePointerMove);
  }, [canPeek, isPeeking, requestUnpeek]);

  if (collapsible === 'none') {
    return (
      <div
        data-slot="sidebar"
        className={cn(
          'flex h-full w-(--sidebar-width) flex-col bg-sidebar text-sidebar-foreground',
          className,
        )}
        {...props}
      >
        {children}
      </div>
    );
  }

  if (!isLarge) {
    return (
      <Sheet open={openMobile} onOpenChange={setOpenMobile}>
        <SheetContent
          data-sidebar="sidebar"
          data-slot="sidebar"
          data-mobile="true"
          showCloseButton={false}
          className={cn(
            'w-(--sidebar-width) bg-sidebar p-0 text-sidebar-foreground',
            className,
          )}
          style={
            {
              '--sidebar-width': SIDEBAR_WIDTH_MOBILE,
              ...props.style,
            } as React.CSSProperties
          }
          side={side}
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Sidebar</SheetTitle>
            <SheetDescription>Displays the mobile sidebar.</SheetDescription>
          </SheetHeader>
          <div className="flex h-full w-full flex-col">{children}</div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <div
      className="group peer hidden text-sidebar-foreground md:block"
      data-state={state}
      data-collapsible={state === 'collapsed' ? collapsible : ''}
      data-variant={variant}
      data-side={side}
      data-mode={mode}
      data-slot="sidebar"
    >
      {/* This is what handles the sidebar gap on desktop */}
      <div
        data-slot="sidebar-gap"
        className={cn(
          'relative w-(--sidebar-width) bg-transparent transition-[width] duration-200 ease-luxe',
          'group-data-[collapsible=offcanvas]:w-0',
          'group-data-[side=right]:rotate-180',
          // Floating peek overlays content; pinning it open reserves real space instead.
          variant === 'floating'
            ? 'w-[calc(var(--sidebar-width-icon)+16px)] group-data-[mode=expanded]:w-(--sidebar-width)'
            : variant === 'inset'
              ? 'group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+16px)]'
              : 'group-data-[collapsible=icon]:w-(--sidebar-width-icon)',
        )}
      />
      <div
        ref={containerRef}
        data-slot="sidebar-container"
        className={cn(
          'fixed top-14 bottom-0 z-10 hidden h-[calc(100svh-3.5rem)] w-(--sidebar-width) transition-[left,right,width] duration-200 ease-luxe md:flex',
          side === 'left'
            ? 'left-0 group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-width)*-1)]'
            : 'right-0 group-data-[collapsible=offcanvas]:right-[calc(var(--sidebar-width)*-1)]',
          variant === 'floating' || variant === 'inset'
            ? 'px-2 pb-4 group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+16px)]'
            : 'group-data-[collapsible=icon]:w-(--sidebar-width-icon) group-data-[side=left]:border-r group-data-[side=right]:border-l',
          className,
        )}
        onMouseEnter={(event) => {
          onMouseEnter?.(event);
          if (canPeek) requestPeek();
        }}
        onMouseLeave={(event) => {
          onMouseLeave?.(event);
          if (canPeek) requestUnpeek();
        }}
        {...restProps}
      >
        <div
          data-sidebar="sidebar"
          data-slot="sidebar-inner"
          className="flex h-full w-full flex-col bg-sidebar group-data-[variant=floating]:rounded-lg group-data-[variant=floating]:border group-data-[variant=floating]:border-sidebar-border group-data-[variant=floating]:shadow-sm"
        >
          {children}
        </div>
      </div>
    </div>
  );
}

function SidebarTrigger({
  className,
  onClick,
  ...props
}: React.ComponentProps<typeof Button>) {
  const { toggleSidebar } = useSidebar();

  return (
    <Button
      data-sidebar="trigger"
      data-slot="sidebar-trigger"
      variant="ghost"
      size="icon"
      className={cn('size-7', className)}
      onClick={(event) => {
        onClick?.(event);
        toggleSidebar();
      }}
      {...props}
    >
      <PanelLeftIcon />
      <span className="sr-only">Toggle Sidebar</span>
    </Button>
  );
}

function SidebarRail({ className, ...props }: React.ComponentProps<'button'>) {
  const { toggleSidebar } = useSidebar();

  return (
    <button
      data-sidebar="rail"
      data-slot="sidebar-rail"
      aria-label="Toggle Sidebar"
      tabIndex={-1}
      onClick={toggleSidebar}
      title="Toggle Sidebar"
      className={cn(
        'absolute inset-y-0 z-20 hidden w-4 -translate-x-1/2 transition-all ease-linear group-data-[side=left]:-right-4 group-data-[side=right]:left-0 after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] hover:after:bg-sidebar-border sm:flex',
        'in-data-[side=left]:cursor-w-resize in-data-[side=right]:cursor-e-resize',
        '[[data-side=left][data-state=collapsed]_&]:cursor-e-resize [[data-side=right][data-state=collapsed]_&]:cursor-w-resize',
        'group-data-[collapsible=offcanvas]:translate-x-0 group-data-[collapsible=offcanvas]:after:left-full hover:group-data-[collapsible=offcanvas]:bg-sidebar',
        '[[data-side=left][data-collapsible=offcanvas]_&]:-right-2',
        '[[data-side=right][data-collapsible=offcanvas]_&]:-left-2',
        className,
      )}
      {...props}
    />
  );
}

function SidebarInset({ className, ...props }: React.ComponentProps<'main'>) {
  return (
    <main
      data-slot="sidebar-inset"
      className={cn(
        'relative flex min-h-0 w-full flex-1 flex-col bg-background',
        'md:peer-data-[variant=inset]:m-2 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:rounded-xl md:peer-data-[variant=inset]:shadow-sm md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ml-2',
        className,
      )}
      {...props}
    />
  );
}

function SidebarInput({
  className,
  ...props
}: React.ComponentProps<typeof Input>) {
  return (
    <Input
      data-slot="sidebar-input"
      data-sidebar="input"
      className={cn('h-8 w-full bg-background shadow-none', className)}
      {...props}
    />
  );
}

function SidebarHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-header"
      data-sidebar="header"
      className={cn('flex flex-col gap-2 p-2', className)}
      {...props}
    />
  );
}

function SidebarFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-footer"
      data-sidebar="footer"
      className={cn('flex flex-col gap-2 p-2', className)}
      {...props}
    />
  );
}

function SidebarSeparator({
  className,
  ...props
}: React.ComponentProps<typeof Separator>) {
  return (
    <Separator
      data-slot="sidebar-separator"
      data-sidebar="separator"
      className={cn('mx-2 w-auto bg-sidebar-border', className)}
      {...props}
    />
  );
}

function SidebarContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-content"
      data-sidebar="content"
      className={cn(
        'flex min-h-0 flex-1 flex-col gap-2 overflow-auto group-data-[collapsible=icon]:overflow-hidden',
        className,
      )}
      {...props}
    />
  );
}

function SidebarGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-group"
      data-sidebar="group"
      className={cn('relative flex w-full min-w-0 flex-col p-2', className)}
      {...props}
    />
  );
}

function SidebarGroupLabel({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<'div'> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'div';

  return (
    <Comp
      data-slot="sidebar-group-label"
      data-sidebar="group-label"
      className={cn(
        'flex h-8 shrink-0 items-center rounded-md px-2 text-xs font-medium text-sidebar-foreground/70 ring-sidebar-ring outline-hidden transition-[margin,opacity] duration-150 ease-out focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0',
        'group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0',
        className,
      )}
      {...props}
    />
  );
}

function SidebarGroupAction({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'button';

  return (
    <Comp
      data-slot="sidebar-group-action"
      data-sidebar="group-action"
      className={cn(
        'absolute top-3.5 right-3 flex aspect-square w-5 items-center justify-center rounded-md p-0 text-sidebar-foreground ring-sidebar-ring outline-hidden transition-transform hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0',
        // Increases the hit area of the button on mobile.
        'after:absolute after:-inset-2 md:after:hidden',
        'group-data-[collapsible=icon]:hidden',
        className,
      )}
      {...props}
    />
  );
}

function SidebarGroupContent({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-group-content"
      data-sidebar="group-content"
      className={cn('w-full text-sm', className)}
      {...props}
    />
  );
}

function SidebarMenu({ className, ...props }: React.ComponentProps<'ul'>) {
  return (
    <ul
      data-slot="sidebar-menu"
      data-sidebar="menu"
      className={cn('flex w-full min-w-0 flex-col gap-1', className)}
      {...props}
    />
  );
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<'li'>) {
  return (
    <li
      data-slot="sidebar-menu-item"
      data-sidebar="menu-item"
      className={cn('group/menu-item relative', className)}
      {...props}
    />
  );
}

const sidebarMenuButtonVariants = cva(
  // No focus ring on rail items — a focused item takes the accent surface instead of a border.
  'peer/menu-button flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm outline-hidden transition-[width,height,padding] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:bg-sidebar-accent focus-visible:text-sidebar-accent-foreground active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 group-has-data-[sidebar=menu-action]/menu-item:pr-8 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground data-[state=open]:hover:bg-sidebar-accent data-[state=open]:hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:p-2! [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
        outline:
          'bg-background shadow-[0_0_0_1px_hsl(var(--sidebar-border))] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:shadow-[0_0_0_1px_hsl(var(--sidebar-accent))]',
      },
      size: {
        default: 'h-8 text-sm',
        sm: 'h-7 text-xs',
        lg: 'h-12 text-sm group-data-[collapsible=icon]:p-0!',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function SidebarMenuButton({
  asChild = false,
  isActive = false,
  variant = 'default',
  size = 'default',
  tooltip,
  className,
  ...props
}: React.ComponentProps<'button'> & {
  asChild?: boolean;
  isActive?: boolean;
  tooltip?: string | React.ComponentProps<typeof TooltipContent>;
} & VariantProps<typeof sidebarMenuButtonVariants>) {
  const Comp = asChild ? Slot : 'button';
  const { isLarge, mode } = useSidebar();

  const button = (
    <Comp
      data-slot="sidebar-menu-button"
      data-sidebar="menu-button"
      data-size={size}
      data-active={isActive}
      className={cn(sidebarMenuButtonVariants({ variant, size }), className)}
      {...props}
    />
  );

  if (!tooltip) {
    return button;
  }

  if (typeof tooltip === 'string') {
    tooltip = {
      children: tooltip,
    };
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      {/* Gated on mode, not momentary state — 'hover' is about to peek open anyway, so only 'collapsed' needs a tooltip. */}
      <TooltipContent
        side="right"
        align="center"
        hidden={mode !== 'collapsed' || !isLarge}
        {...tooltip}
      />
    </Tooltip>
  );
}

function SidebarMenuAction({
  className,
  asChild = false,
  showOnHover = false,
  ...props
}: React.ComponentProps<'button'> & {
  asChild?: boolean;
  showOnHover?: boolean;
}) {
  const Comp = asChild ? Slot : 'button';

  return (
    <Comp
      data-slot="sidebar-menu-action"
      data-sidebar="menu-action"
      className={cn(
        'absolute top-1.5 right-1 flex aspect-square w-5 items-center justify-center rounded-md p-0 text-sidebar-foreground ring-sidebar-ring outline-hidden transition-transform peer-hover/menu-button:text-sidebar-accent-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0',
        // Increases the hit area of the button on mobile.
        'after:absolute after:-inset-2 md:after:hidden',
        'peer-data-[size=sm]/menu-button:top-1',
        'peer-data-[size=default]/menu-button:top-1.5',
        'peer-data-[size=lg]/menu-button:top-2.5',
        'group-data-[collapsible=icon]:hidden',
        showOnHover &&
          'peer-data-[active=true]/menu-button:text-sidebar-accent-foreground group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100 data-[state=open]:opacity-100 md:opacity-0',
        className,
      )}
      {...props}
    />
  );
}

function SidebarMenuBadge({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-menu-badge"
      data-sidebar="menu-badge"
      className={cn(
        'pointer-events-none absolute right-1 flex h-5 min-w-5 items-center justify-center rounded-md px-1 text-xs font-medium text-sidebar-foreground tabular-nums select-none',
        'peer-hover/menu-button:text-sidebar-accent-foreground peer-data-[active=true]/menu-button:text-sidebar-accent-foreground',
        'peer-data-[size=sm]/menu-button:top-1',
        'peer-data-[size=default]/menu-button:top-1.5',
        'peer-data-[size=lg]/menu-button:top-2.5',
        'group-data-[collapsible=icon]:hidden',
        className,
      )}
      {...props}
    />
  );
}

function SidebarMenuSkeleton({
  className,
  showIcon = false,
  ...props
}: React.ComponentProps<'div'> & {
  showIcon?: boolean;
}) {
  // Pseudo-random width between 50 to 90%, derived from a stable id instead of Math.random so render stays pure.
  const id = React.useId();
  const width = React.useMemo(() => {
    const hash = Array.from(id).reduce(
      (acc, char) => acc + char.charCodeAt(0),
      0,
    );
    return `${50 + (hash % 40)}%`;
  }, [id]);

  return (
    <div
      data-slot="sidebar-menu-skeleton"
      data-sidebar="menu-skeleton"
      className={cn('flex h-8 items-center gap-2 rounded-md px-2', className)}
      {...props}
    >
      {showIcon && (
        <Skeleton
          className="size-4 rounded-md"
          data-sidebar="menu-skeleton-icon"
        />
      )}
      <Skeleton
        className="h-4 max-w-(--skeleton-width) flex-1"
        data-sidebar="menu-skeleton-text"
        style={
          {
            '--skeleton-width': width,
          } as React.CSSProperties
        }
      />
    </div>
  );
}

function SidebarMenuSub({ className, ...props }: React.ComponentProps<'ul'>) {
  return (
    <ul
      data-slot="sidebar-menu-sub"
      data-sidebar="menu-sub"
      className={cn(
        'mx-3.5 flex min-w-0 translate-x-px flex-col gap-1 border-l border-sidebar-border px-2.5 py-0.5',
        'group-data-[collapsible=icon]:hidden',
        className,
      )}
      {...props}
    />
  );
}

function SidebarMenuSubItem({
  className,
  ...props
}: React.ComponentProps<'li'>) {
  return (
    <li
      data-slot="sidebar-menu-sub-item"
      data-sidebar="menu-sub-item"
      className={cn('group/menu-sub-item relative', className)}
      {...props}
    />
  );
}

function SidebarMenuSubButton({
  asChild = false,
  size = 'md',
  isActive = false,
  className,
  ...props
}: React.ComponentProps<'a'> & {
  asChild?: boolean;
  size?: 'sm' | 'md';
  isActive?: boolean;
}) {
  const Comp = asChild ? Slot : 'a';

  return (
    <Comp
      data-slot="sidebar-menu-sub-button"
      data-sidebar="menu-sub-button"
      data-size={size}
      data-active={isActive}
      className={cn(
        'flex h-7 min-w-0 -translate-x-px items-center gap-2 overflow-hidden rounded-md px-2 text-sidebar-foreground outline-hidden hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:bg-sidebar-accent focus-visible:text-sidebar-accent-foreground active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-sidebar-accent-foreground',
        'data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground',
        size === 'sm' && 'text-xs',
        size === 'md' && 'text-sm',
        'group-data-[collapsible=icon]:hidden',
        className,
      )}
      {...props}
    />
  );
}

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
};
export type { SidebarMode };
