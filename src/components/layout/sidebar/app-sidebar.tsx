'use client';

import { getNav } from '@/lib/nav';
import { useSession } from '@/hooks/use-session';
import { RAIL_SURFACE_CLASS } from '@/components/layout/dark-rail-theme';
import { NavMain } from '@/components/layout/sidebar/nav-main';
import { SidebarSettings } from '@/components/layout/sidebar/sidebar-settings';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  useSidebar,
} from '@/components/layout/sidebar/sidebar-primitives';
import { cn } from '@/lib/utils';

// The account menu lives in the navbar (`layout/header-user.tsx`); the rail
// footer only carries its own display settings.
export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { isLarge, setOpenMobile } = useSidebar();
  const { user, inbox } = useSession();

  return (
    <Sidebar
      variant="floating"
      collapsible="icon"
      className={cn(
        'z-40 text-sidebar-foreground group-data-[state=expanded]:**:data-[slot=sidebar-inner]:shadow-xl',
        RAIL_SURFACE_CLASS,
      )}
      {...props}
    >
      <SidebarContent className="scrollbar-hide gap-1 py-1 group-data-[collapsible=icon]:overflow-y-auto!">
        {user && (
          <NavMain
            categories={getNav(user, inbox)}
            onNavigate={() => {
              if (!isLarge) setOpenMobile(false);
            }}
          />
        )}
      </SidebarContent>
      <SidebarFooter className="gap-0 p-2 pt-0">
        <SidebarSettings />
      </SidebarFooter>
    </Sidebar>
  );
}
