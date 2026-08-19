'use client';

import { PanelLeftClose, PanelLeftDashed, PanelLeftOpen } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@tenminuteschool/design-system';
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
  type SidebarMode,
} from '@/components/layout/sidebar/sidebar-primitives';

const SIDEBAR_MODE_OPTIONS: {
  value: SidebarMode;
  label: string;
  icon: typeof PanelLeftOpen;
}[] = [
  { value: 'expanded', label: 'Expanded', icon: PanelLeftOpen },
  { value: 'collapsed', label: 'Collapsed', icon: PanelLeftClose },
  { value: 'hover', label: 'Expand on hover', icon: PanelLeftDashed },
];

/**
 * Bottom item of the rail: picks how the rail behaves. Desktop only — on mobile
 * the rail is a drawer, so the modes have nothing to act on.
 */
export function SidebarSettings() {
  const { mode, setMode, isLarge, setPeekLocked } = useSidebar();

  if (!isLarge) return null;

  const active =
    SIDEBAR_MODE_OPTIONS.find((option) => option.value === mode) ??
    SIDEBAR_MODE_OPTIONS[0];
  const ActiveIcon = active.icon;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        {/* Holds a hover-peek open while the menu is up. */}
        <DropdownMenu onOpenChange={setPeekLocked}>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              tooltip="Sidebar"
              aria-label="Sidebar settings"
              className="[&>svg]:size-[18px]! data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <ActiveIcon size={18} />
              <span className="truncate group-data-[collapsible=icon]:hidden">
                Sidebar
              </span>
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="right"
            align="end"
            sideOffset={10}
            className="min-w-48 rounded-lg"
          >
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              Sidebar
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={mode}
              onValueChange={(value) => setMode(value as SidebarMode)}
            >
              {SIDEBAR_MODE_OPTIONS.map(({ value, label, icon: Icon }) => (
                <DropdownMenuRadioItem key={value} value={value}>
                  <Icon />
                  {label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
