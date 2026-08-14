/**
 * Role-aware sidebar information architecture.
 *
 * Pure data: every console builds its sidebar from this module so the grouping,
 * ordering and per-role visibility can be asserted in tests. Navigation is UX
 * only — the database still authorizes every read and write, so hiding an entry
 * here never grants or removes a permission.
 */
import type { LinkProps } from "@tanstack/react-router";
import type { ComponentType } from "react";
import {
  Banknote,
  BarChart3,
  Building2,
  Coins,
  DatabaseBackup,
  Gift,
  History,
  LayoutDashboard,
  Link2,
  MessageSquare,
  MessagesSquare,
  Package,
  ReceiptText,
  ScrollText,
  Send,
  Settings,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Ticket,
  User,
  UserCheck,
  UserPlus,
  Users,
  UserSquare2,
  Wallet,
} from "lucide-react";
import { SOCIAL_ENABLED } from "@/lib/features";
import type { Role } from "@/lib/wavewallet";

export interface NavItem {
  to: NonNullable<LinkProps["to"]>;
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Optional attention count (e.g. items waiting for review). */
  badge?: number;
}

export interface NavGroup {
  /** Section heading shown in the expanded sidebar. */
  label?: string;
  items: NavItem[];
}

export type Nav = NavGroup[];

/** Every item in a grouped nav, in visual order. */
export const flattenNav = (nav: Nav): NavItem[] => nav.flatMap((g) => g.items);

/** Every destination in a grouped nav, in visual order. */
export const navPaths = (nav: Nav): string[] => flattenNav(nav).map((i) => String(i.to));

/** Applies live counters (pending queues) to matching destinations. */
export function withBadges(nav: Nav, badges: Record<string, number>): Nav {
  return nav.map((group) => ({
    ...group,
    items: group.items.map((item) => {
      const count = badges[String(item.to)];
      return count && count > 0 ? { ...item, badge: count } : item;
    }),
  }));
}

/** Keeps only the destinations allowed while a shop is locked out. */
export function restrictNav(nav: Nav, allowed: string[], extra?: NavItem): Nav {
  const groups = nav
    .map((g) => ({ ...g, items: g.items.filter((i) => allowed.includes(String(i.to))) }))
    .filter((g) => g.items.length > 0);
  return extra ? [...groups, { label: "Account", items: [extra] }] : groups;
}

/* ------------------------------------------------------------------ */
/* Customer                                                            */
/* ------------------------------------------------------------------ */

const customerSocial: NavItem[] = [
  { to: "/app/social", label: "Community", icon: Users },
  { to: "/app/messages", label: "Messages", icon: MessageSquare },
];

export function customerNav(): Nav {
  return [
    {
      label: "Account",
      items: [
        { to: "/app/profile", label: "Profile", icon: User },
        { to: "/app", label: "Wallet", icon: Wallet },
      ],
    },
    {
      label: "Shop",
      items: [
        { to: "/app/shop", label: "Voucher shop", icon: ShoppingBag },
        { to: "/app/rewards", label: "Rewards", icon: Gift },
      ],
    },
    {
      label: "Money",
      items: [
        { to: "/app/transfer", label: "Transfer", icon: Send },
        { to: "/app/money", label: "Cash out & cash in", icon: Banknote },
        { to: "/app/history", label: "Transaction history", icon: History },
      ],
    },
    ...(SOCIAL_ENABLED ? [{ label: "Community", items: customerSocial }] : []),
  ];
}

export const customerBottomNav: NavItem[] = [
  { to: "/app", label: "Wallet", icon: Wallet },
  { to: "/app/shop", label: "Shop", icon: ShoppingBag },
  { to: "/app/transfer", label: "Send", icon: Send },
  { to: "/app/history", label: "History", icon: History },
  { to: "/app/profile", label: "Profile", icon: User },
];

/* ------------------------------------------------------------------ */
/* Reseller / Subreseller                                              */
/* ------------------------------------------------------------------ */

/**
 * A subreseller sees everything a customer does plus the applications queue
 * they are already authorized to review. A reseller additionally gets the
 * downline, redemption, earnings and reporting sections. Both share the
 * /reseller workspace; the database decides what each may actually do.
 */
export function resellerNav(role: Role = "reseller"): Nav {
  const isReseller = role === "reseller" || role === "super_admin" || role === "admin";
  const business: NavItem[] = [
    { to: "/reseller/applications", label: "Applications", icon: UserPlus },
    ...(isReseller
      ? ([
          { to: "/reseller/customers", label: "Downlines", icon: Users },
          { to: "/reseller/redemptions", label: "Redemptions", icon: Gift },
          { to: "/reseller/earnings", label: "Earning history", icon: Coins },
          { to: "/reseller/reports", label: "Reports", icon: BarChart3 },
        ] as NavItem[])
      : []),
  ];

  return [
    {
      label: "Account",
      items: [
        { to: "/reseller/profile", label: "Profile", icon: User },
        { to: "/reseller", label: "Dashboard", icon: LayoutDashboard },
        { to: "/reseller/wallet", label: "Wallet", icon: Wallet },
      ],
    },
    {
      label: "Shop",
      items: [
        { to: "/reseller/shop", label: "Voucher shop", icon: ShoppingCart },
        { to: "/reseller/rewards", label: "Rewards", icon: Gift },
      ],
    },
    {
      label: "Money",
      items: [
        { to: "/reseller/transfer", label: "Transfer", icon: Send },
        { to: "/reseller/money", label: "Cash out & cash in", icon: Banknote },
        { to: "/reseller/history", label: "Transaction history", icon: History },
      ],
    },
    { label: "Business", items: business },
    ...(SOCIAL_ENABLED
      ? [
          {
            label: "Community",
            items: [
              { to: "/reseller/social", label: "Community", icon: Users },
              { to: "/reseller/messages", label: "Messages", icon: MessageSquare },
            ] as NavItem[],
          },
        ]
      : []),
  ];
}

export const resellerBottomNav: NavItem[] = [
  { to: "/reseller", label: "Home", icon: LayoutDashboard },
  { to: "/reseller/shop", label: "Shop", icon: ShoppingCart },
  { to: "/reseller/wallet", label: "Wallet", icon: Wallet },
  { to: "/reseller/applications", label: "Apps", icon: UserPlus },
  { to: "/reseller/profile", label: "Profile", icon: User },
];

/* ------------------------------------------------------------------ */
/* Admin                                                               */
/* ------------------------------------------------------------------ */

export function adminNav(): Nav {
  return [
    {
      label: "Overview",
      items: [{ to: "/admin", label: "Dashboard", icon: LayoutDashboard }],
    },
    {
      label: "Members",
      items: [
        { to: "/admin/resellers", label: "Resellers", icon: Users },
        { to: "/admin/customers", label: "Customers", icon: UserSquare2 },
        { to: "/admin/applications", label: "Applications", icon: UserPlus },
        { to: "/admin/signup-link", label: "Signup link", icon: Link2 },
      ],
    },
    {
      label: "Shop",
      items: [
        { to: "/admin/products", label: "Voucher products", icon: Package },
        { to: "/admin/vouchers", label: "Code inventory", icon: Ticket },
        { to: "/admin/shop", label: "Voucher shop", icon: ShoppingBag },
        { to: "/admin/rewards", label: "Rewards", icon: Gift },
      ],
    },
    {
      label: "Money",
      items: [
        { to: "/admin/credits", label: "Shop credits", icon: Coins },
        { to: "/admin/wallets", label: "Wallets & transfers", icon: Wallet },
        { to: "/admin/money", label: "Cash out & cash in", icon: Banknote },
        { to: "/admin/transactions", label: "Transactions", icon: ReceiptText },
      ],
    },
    {
      label: "Insights",
      items: [
        { to: "/admin/reports", label: "Reports", icon: BarChart3 },
        { to: "/admin/operator-log", label: "Operator actions", icon: UserCheck },
      ],
    },
    ...(SOCIAL_ENABLED
      ? [
          {
            label: "Community",
            items: [
              { to: "/admin/social", label: "Community", icon: MessagesSquare },
            ] as NavItem[],
          },
        ]
      : []),
    {
      label: "Account",
      items: [
        { to: "/admin/settings", label: "Ecosystem settings", icon: Settings },
        { to: "/admin/profile", label: "Profile", icon: User },
      ],
    },
  ];
}

export const adminBottomNav: NavItem[] = [
  { to: "/admin", label: "Home", icon: LayoutDashboard },
  { to: "/admin/vouchers", label: "Codes", icon: Ticket },
  { to: "/admin/wallets", label: "Wallets", icon: Wallet },
  { to: "/admin/applications", label: "Apps", icon: UserPlus },
  { to: "/admin/profile", label: "Profile", icon: User },
];

/** Read-only screens a lapsed shop keeps, plus the renewal screen. */
export const adminGatedPaths = ["/admin", "/admin/reports", "/admin/subscription"];

/* ------------------------------------------------------------------ */
/* Super Admin                                                         */
/* ------------------------------------------------------------------ */

export function superAdminNav(): Nav {
  return [
    {
      label: "Overview",
      items: [{ to: "/super", label: "Overview", icon: LayoutDashboard }],
    },
    {
      label: "Approvals",
      items: [{ to: "/super/approvals", label: "Approvals", icon: ShieldCheck }],
    },
    {
      label: "Directory",
      items: [
        { to: "/super/admins", label: "Ecosystems", icon: Building2 },
        { to: "/super/members", label: "Ecosystem members", icon: Users },
      ],
    },
    {
      label: "Money",
      items: [{ to: "/super/credits", label: "Credit management", icon: Coins }],
    },
    {
      label: "Insights",
      items: [
        { to: "/super/reports", label: "Reports", icon: BarChart3 },
        { to: "/super/export", label: "Data export", icon: DatabaseBackup },
        { to: "/super/audit", label: "Audit log", icon: ScrollText },
        { to: "/super/operator-log", label: "Operator actions", icon: UserCheck },
      ],
    },
    {
      label: "Account",
      items: [
        { to: "/super/settings", label: "Platform", icon: Settings },
        { to: "/super/profile", label: "Profile", icon: User },
      ],
    },
  ];
}

export const superBottomNav: NavItem[] = [
  { to: "/super", label: "Home", icon: LayoutDashboard },
  { to: "/super/approvals", label: "Approvals", icon: ShieldCheck },
  { to: "/super/members", label: "Members", icon: Users },
  { to: "/super/credits", label: "Credits", icon: Coins },
  { to: "/super/profile", label: "Profile", icon: User },
];

/** The sidebar for a role, used by tests and by each console layout. */
export function navForRole(role: Role): Nav {
  switch (role) {
    case "super_admin":
      return superAdminNav();
    case "admin":
      return adminNav();
    case "reseller":
    case "subreseller":
      return resellerNav(role);
    default:
      return customerNav();
  }
}
