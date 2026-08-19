'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { NavCategory, NavItem } from '@/lib/nav';
import { isNavItemActive } from '@/lib/nav';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@tenminuteschool/design-system';
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from '@/components/layout/sidebar/sidebar-primitives';
import { cn } from '@/lib/utils';

const FLYOUT_OPEN_DELAY = 100;
const FLYOUT_CLOSE_DELAY = 150;

function NavItemFlyout({
  item,
  isActive,
}: {
  item: NavItem;
  isActive: (href: string) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = () => {
    if (openTimer.current) {
      clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const scheduleOpen = () => {
    clearTimers();
    openTimer.current = setTimeout(() => setOpen(true), FLYOUT_OPEN_DELAY);
  };

  const scheduleClose = () => {
    clearTimers();
    closeTimer.current = setTimeout(() => setOpen(false), FLYOUT_CLOSE_DELAY);
  };

  useEffect(() => clearTimers, []);

  const Icon = item.icon;
  const active = item.items?.some((child) => isActive(child.href)) ?? false;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <SidebarMenuItem
          onMouseEnter={scheduleOpen}
          onMouseLeave={scheduleClose}
        >
          <SidebarMenuButton
            isActive={active}
            aria-label={item.label}
            aria-haspopup="menu"
            aria-expanded={open}
            className="[&>svg]:size-[18px]!"
            onClick={() => setOpen((prev) => !prev)}
          >
            <Icon size={18} />
            <span className="truncate group-data-[collapsible=icon]:hidden">
              {item.label}
            </span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </PopoverAnchor>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={10}
        onMouseEnter={scheduleOpen}
        onMouseLeave={scheduleClose}
        className="w-52 rounded-lg p-1.5 shadow-lg"
      >
        <div className="truncate px-2 py-1.5 text-xs font-semibold text-muted-foreground">
          {item.label}
        </div>
        <div className="flex flex-col gap-0.5">
          {item.items?.map((child) => (
            <Link
              key={child.label}
              href={child.href}
              onClick={() => setOpen(false)}
              className={cn(
                'truncate rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent hover:text-accent-foreground',
                isActive(child.href) &&
                  'bg-accent font-medium text-accent-foreground',
              )}
            >
              {child.label}
            </Link>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function NavMain({
  categories,
  onNavigate,
}: {
  categories: NavCategory[];
  /** Called after a link is followed — closes the mobile sheet. */
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const { state, mode, isLarge, toggleSidebar } = useSidebar();
  const collapsed = state === 'collapsed' && isLarge;
  // sidebar (mode === 'collapsed', peek disabled entirely) needs the flyout.
  const flyoutMode = mode === 'collapsed' && isLarge;

  const isActive = (href: string) => isNavItemActive(pathname, href);

  return (
    <>
      {categories.map((categoryGroup, index) => (
        <SidebarGroup key={categoryGroup.category} className="py-1">
          {!categoryGroup.hideLabel && (
            // Cancels the default -mt-8 collapse trick so height stays reserved; label/separator crossfade as absolute siblings.
            <SidebarGroupLabel className="relative h-6 group-data-[collapsible=icon]:mt-0 group-data-[collapsible=icon]:opacity-100">
              <span className="truncate transition-opacity duration-150 group-data-[collapsible=icon]:opacity-0">
                {categoryGroup.category}
              </span>
              {index > 0 && ( // first section has nothing above it to separate from
                <span
                  aria-hidden
                  className="absolute inset-x-2 top-1/2 h-px -translate-y-1/2 bg-sidebar-border opacity-0 transition-opacity duration-150 group-data-[collapsible=icon]:opacity-30"
                />
              )}
            </SidebarGroupLabel>
          )}
          <SidebarMenu>
            {categoryGroup.items.map((item) => {
              const hasChildren = !!item.items && item.items.length > 0;
              const Icon = item.icon;

              // Same element in both modes so the icon never moves — only the label toggles via CSS.
              if (!hasChildren) {
                // Stands out as a solid CTA against the always-dark rail surface, not just another nav row.
                const isNewRequest = item.href === '/new-request';

                return (
                  <SidebarMenuItem key={item.label}>
                    <SidebarMenuButton
                      asChild
                      tooltip={item.label}
                      isActive={isActive(item.href)}
                      className={cn(
                        '[&>svg]:size-[18px]!',
                        isNewRequest &&
                          'bg-white! font-medium text-neutral-900! hover:bg-neutral-100! focus-visible:bg-neutral-100! active:bg-neutral-200! data-[active=true]:bg-white! data-[active=true]:text-neutral-900!',
                      )}
                    >
                      <Link
                        href={item.href}
                        aria-label={item.label}
                        onClick={onNavigate}
                      >
                        <Icon size={18} />
                        <span className="flex-1 truncate group-data-[collapsible=icon]:hidden">
                          {item.label}
                        </span>
                        {!!item.badge && (
                          <span className="ml-auto flex size-5 shrink-0 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-white group-data-[collapsible=icon]:hidden">
                            {item.badge}
                          </span>
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              }

              if (flyoutMode) {
                return (
                  <NavItemFlyout
                    key={item.label}
                    item={item}
                    isActive={isActive}
                  />
                );
              }

              const active =
                item.items?.some((child) => isActive(child.href)) ?? false;

              return (
                <Collapsible
                  key={item.label}
                  asChild
                  defaultOpen={active}
                  className="group/collapsible"
                >
                  <SidebarMenuItem>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton
                        tooltip={item.label}
                        isActive={collapsed && active}
                        aria-label={item.label}
                        className="[&>svg]:size-[18px]!"
                        onClick={() => {
                          if (collapsed) toggleSidebar();
                        }}
                      >
                        <Icon size={18} />
                        {/* Chevron follows it, so it's not last-child and needs its own truncate. */}
                        <span className="truncate group-data-[collapsible=icon]:hidden">
                          {item.label}
                        </span>
                        <ChevronRight className="ml-auto shrink-0 transition-transform duration-150 group-data-[collapsible=icon]:hidden group-data-[state=open]/collapsible:rotate-90" />
                      </SidebarMenuButton>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="group-data-[collapsible=icon]:hidden">
                      <SidebarMenuSub>
                        {item.items?.map((child) => (
                          <SidebarMenuSubItem key={child.label}>
                            <SidebarMenuSubButton
                              asChild
                              isActive={isActive(child.href)}
                            >
                              <Link href={child.href} onClick={onNavigate}>
                                <span>{child.label}</span>
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))}
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </SidebarMenuItem>
                </Collapsible>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      ))}
    </>
  );
}
