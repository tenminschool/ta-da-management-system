import type { LucideIcon } from 'lucide-react';
import {
  Banknote,
  Car,
  FileText,
  HandCoins,
  Inbox,
  LayoutDashboard,
  ListChecks,
  Plus,
  Settings,
  Wallet,
} from 'lucide-react';
import type { SessionUser } from '@/shared/types';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Sub-items render as a collapsible group (a hover flyout on the icon rail). */
  items?: NavItem[];
  badge?: number;
}

export interface NavCategory {
  category: string;
  /** Hides the section label; the collapsed rail still draws a separator. */
  hideLabel?: boolean;
  items: NavItem[];
}

/** Every item that can appear in the sidebar, regardless of role — used for title lookup. */
const ALL_ITEMS: NavItem[] = [
  { label: 'New Request', href: '/new-request', icon: Plus },
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'My Requests', href: '/my-requests', icon: FileText },
  { label: 'My Advance', href: '/my-advance', icon: HandCoins },
  { label: 'My Payments', href: '/my-payments', icon: Wallet },
  { label: 'Register your Vehicle', href: '/my-vehicle', icon: Car },
  { label: 'Dashboard', href: '/desk', icon: LayoutDashboard },
  { label: 'All Claims', href: '/desk/all', icon: ListChecks },
  { label: 'Pending Approvals', href: '/desk/pending', icon: Inbox },
  { label: 'Advance Approvals', href: '/desk/advances', icon: HandCoins },
  { label: 'Vehicle Registrations', href: '/desk/vehicles', icon: Car },
  { label: 'Payments', href: '/desk/payments', icon: Banknote },
  { label: 'Configuration', href: '/admin', icon: Settings },
];

/**
 * The sidebar's nav, role-gated — "My Claims" is everyone's; "Approval Desk"
 * only exists for people who approve something. Mirrors the old SPA's
 * selfNav/deskNav split, just as two always-visible categories instead of a
 * workspace switcher: either can be jumped into directly.
 */
export function getNav(user: SessionUser, inbox: number): NavCategory[] {
  const isAdmin = user.roles.some((r) => ['admin', 'hr'].includes(r));
  const isFinance = user.roles.includes('finance');
  const isApprover = isAdmin || isFinance || !!user.managesOthers;
  const reviewsAdvances = isAdmin || isFinance || !!user.managesOthers;

  const quickActions: NavCategory = {
    category: 'Quick Actions',
    hideLabel: true,
    items: [{ label: 'New Request', href: '/new-request', icon: Plus }],
  };

  const my: NavCategory = {
    category: 'My Claims',
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
      { label: 'My Requests', href: '/my-requests', icon: FileText },
      { label: 'My Advance', href: '/my-advance', icon: HandCoins },
      { label: 'My Payments', href: '/my-payments', icon: Wallet },
      { label: 'Register your Vehicle', href: '/my-vehicle', icon: Car },
    ],
  };

  if (!isApprover) return [quickActions, my];

  const desk: NavCategory = {
    category: 'Approval Desk',
    items: [
      ...(isAdmin || isFinance
        ? [{ label: 'Dashboard', href: '/desk', icon: LayoutDashboard }]
        : []),
      { label: 'All Claims', href: '/desk/all', icon: ListChecks },
      {
        label: 'Pending Approvals',
        href: '/desk/pending',
        icon: Inbox,
        badge: inbox || undefined,
      },
      ...(reviewsAdvances
        ? [
            {
              label: 'Advance Approvals',
              href: '/desk/advances',
              icon: HandCoins,
            },
          ]
        : []),
      ...(isAdmin
        ? [
            {
              label: 'Vehicle Registrations',
              href: '/desk/vehicles',
              icon: Car,
            },
          ]
        : []),
      ...(isFinance || isAdmin
        ? [{ label: 'Payments', href: '/desk/payments', icon: Banknote }]
        : []),
      ...(isAdmin
        ? [{ label: 'Configuration', href: '/admin', icon: Settings }]
        : []),
    ],
  };

  return [quickActions, my, desk];
}

export function isNavItemActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function getNavTitle(pathname: string): string {
  // Longest-matching href wins — "/desk" and "/desk/pending" both match
  // "/desk/pending", and only the more specific one is the right title.
  let best: NavItem | null = null;
  for (const item of ALL_ITEMS) {
    if (
      isNavItemActive(pathname, item.href) &&
      (!best || item.href.length > best.href.length)
    ) {
      best = item;
    }
  }
  return best?.label ?? 'Dashboard';
}
