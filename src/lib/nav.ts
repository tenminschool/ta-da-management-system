import type { LucideIcon } from 'lucide-react';
import { LayoutDashboard } from 'lucide-react';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Sub-items render as a collapsible group (a hover flyout on the icon rail). */
  items?: NavItem[];
}

export interface NavCategory {
  category: string;
  /** Hides the section label; the collapsed rail still draws a separator. */
  hideLabel?: boolean;
  items: NavItem[];
}

/**
 * Sidebar navigation — single source of truth.
 *
 * ```ts
 * {
 *   category: 'Administrator',
 *   items: [
 *     { label: 'Users', href: '/users', icon: Users },
 *     {
 *       label: 'Settings',
 *       href: '/settings',
 *       icon: Settings,
 *       items: [{ label: 'Teams', href: '/settings/teams', icon: Network }],
 *     },
 *   ],
 * }
 * ```
 */
export const NAV: NavCategory[] = [
  {
    category: 'Main',
    hideLabel: true,
    items: [{ label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard }],
  },
];

export function isNavItemActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function getNavTitle(pathname: string): string {
  for (const category of NAV) {
    for (const item of category.items) {
      const child = item.items?.find((child) =>
        isNavItemActive(pathname, child.href),
      );
      if (child) return child.label;
      if (isNavItemActive(pathname, item.href)) return item.label;
    }
  }
  return 'Dashboard';
}
