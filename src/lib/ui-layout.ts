/**
 * Developer Mode — role-level UI visibility configuration.
 *
 * Pure data + pure functions. A layout says, for one ROLE (never one account),
 * which navigation entries and which in-page content blocks are hidden, and in
 * what order the navigation entries appear.
 *
 * Everything here is presentation only. Hiding a tab or a block never removes a
 * route, a query, a calculation or a permission — the database still authorizes
 * every read and write, and hidden blocks stay mounted so their background work
 * keeps running. Content blocks can be hidden and restored, never relocated.
 */
import {
  adminBottomNav,
  customerBottomNav,
  navForRole,
  resellerBottomNav,
  superBottomNav,
  type Nav,
  type NavItem,
} from "@/lib/navigation";
import type { Role } from "@/lib/wavewallet";

export const DEV_MODE_ROLES: Role[] = [
  "customer",
  "reseller",
  "subreseller",
  "admin",
  "super_admin",
];

export const roleTitle = (role: Role): string =>
  role === "super_admin"
    ? "Super Admin"
    : role === "admin"
      ? "Admin"
      : role === "reseller"
        ? "Reseller"
        : role === "subreseller"
          ? "Subreseller"
          : "Customer";

/** Stored per-slot overrides. All fields optional; absent means "default". */
export interface SlotOverride {
  hidden?: boolean;
}

export interface LayoutPayload {
  tabs?: {
    /** Left/side navigation order (paths). Unlisted entries keep their natural order. */
    order?: string[];
    /** Mobile bottom navigation order (paths). Independent from the side navigation. */
    bottomOrder?: string[];
    /** Paths hidden from navigation (route + data keep working). */
    hidden?: string[];
  };
  slots?: Record<string, SlotOverride>;
}

export type LayoutMap = Partial<Record<Role, LayoutPayload>>;

export const EMPTY_LAYOUT: LayoutPayload = {};

/** A configurable in-page content block. Identified by a stable id, never by label. */
export interface SlotDefinition {
  /** `<rolePrefix>.<name>` — written into the database; never rename without a migration. */
  id: string;
  /** Name used by `<DevSlot name="..." />` / `<PageSection devSlot="..." />`. */
  name: string;
  role: Role;
  label: string;
  /** Screen or panel the block belongs to; used to group the manager list. */
  group: string;
}

interface SlotSource {
  name: string;
  label: string;
  group: string;
  roles: Role[];
}

const ROLE_PREFIX: Record<Role, string> = {
  customer: "customer",
  reseller: "reseller",
  subreseller: "subreseller",
  admin: "admin",
  super_admin: "super",
};

export const slotPrefix = (role: Role): string => ROLE_PREFIX[role] ?? "customer";
export const slotIdFor = (role: Role, name: string): string => `${slotPrefix(role)}.${name}`;

/**
 * Registry of configurable, user-facing content. Technical internals,
 * authentication and security elements are deliberately absent: they must never
 * be hideable.
 */
const SLOT_SOURCE: SlotSource[] = [
  { name: "admin-earnings-panel.wallet-earnings", label: "Wallet & earnings", group: "Admin Earnings", roles: ["customer", "reseller", "subreseller", "admin", "super_admin"] },
  { name: "admins.operator-invitations", label: "Operator invitations", group: "Admins", roles: ["super_admin"] },
  { name: "admins.tenant-shops", label: "Tenant shops", group: "Admins", roles: ["super_admin"] },
  { name: "app-release-card.official-android-app-release", label: "Official Android app release", group: "App Release", roles: ["super_admin"] },
  { name: "applications-panel.applications", label: "Applications", group: "Applications", roles: ["customer", "reseller", "subreseller", "admin", "super_admin"] },
  { name: "audit.audit-trail", label: "Audit trail", group: "Audit", roles: ["super_admin"] },
  { name: "connected-logins-card.connected-logins", label: "Connected logins", group: "Connected Logins", roles: ["customer", "reseller", "subreseller", "admin", "super_admin"] },
  { name: "credit-purchase-page.allocation-history", label: "Allocation history", group: "Credit Purchase Page", roles: ["customer", "reseller", "subreseller", "admin", "super_admin"] },
  { name: "credit-purchase-page.get-coins-for-your-shop", label: "Get coins for your shop", group: "Credit Purchase Page", roles: ["customer", "reseller", "subreseller", "admin", "super_admin"] },
  { name: "credit-requests-card.shop-coin-requests", label: "Shop coin requests", group: "Credit Requests", roles: ["super_admin"] },
  { name: "credit-supply-card.admin-pricing-settings", label: "Admin pricing settings", group: "Credit Supply", roles: ["super_admin"] },
  { name: "credit-supply-card.coin-supply", label: "Coin supply", group: "Credit Supply", roles: ["super_admin"] },
  { name: "customers.customer-directory", label: "Customer directory", group: "Customers", roles: ["admin"] },
  { name: "customers.load-customer-coins", label: "Load customer coins", group: "Customers", roles: ["reseller", "subreseller"] },
  { name: "customers.load-history", label: "Load history", group: "Customers", roles: ["reseller", "subreseller"] },
  { name: "dashboard.activity", label: "Recent activity", group: "Dashboard", roles: ["admin"] },
  { name: "dashboard.demo", label: "Demo shop banner", group: "Dashboard", roles: ["admin"] },
  { name: "dashboard.downlines", label: "Downlines snapshot", group: "Dashboard", roles: ["reseller", "subreseller"] },
  { name: "dashboard.earnings", label: "Shop earnings panel", group: "Dashboard", roles: ["admin"] },
  { name: "dashboard.sales", label: "Voucher sales", group: "Dashboard", roles: ["admin"] },
  { name: "dashboard.signup-link", label: "Customer signup link card", group: "Dashboard", roles: ["admin"] },
  { name: "dashboard.stats", label: "Shop figures", group: "Dashboard", roles: ["admin"] },
  { name: "dashboard.subscription", label: "Subscription countdown", group: "Dashboard", roles: ["admin"] },

  { name: "dashboard.summary", label: "Shop summary", group: "Dashboard", roles: ["reseller", "subreseller"] },
  { name: "dashboard.wallet-activity", label: "Wallet activity", group: "Dashboard", roles: ["reseller", "subreseller"] },
  { name: "wallet.center", label: "Wallet Center panel", group: "Dashboard", roles: ["customer"] },
  { name: "earnings-history.earning-transactions", label: "Earning transactions", group: "Earnings History", roles: ["customer", "reseller", "subreseller", "admin", "super_admin"] },
  { name: "earnings-history.earnings-history", label: "Earnings History", group: "Earnings History", roles: ["customer", "reseller", "subreseller", "admin", "super_admin"] },
  { name: "earnings-history.earnings-history-2", label: "Earnings History", group: "Earnings History", roles: ["customer", "reseller", "subreseller", "admin", "super_admin"] },
  { name: "earnings-history.period-summary", label: "Period summary", group: "Earnings History", roles: ["customer", "reseller", "subreseller", "admin", "super_admin"] },
  { name: "earnings-summary-cards.earnings-summary-s", label: "Earnings Summary S", group: "Earnings Summary S", roles: ["customer", "reseller", "subreseller", "admin", "super_admin"] },
  { name: "ecosystem-social-card.community-settings", label: "Community settings", group: "Ecosystem Social", roles: ["customer", "reseller", "subreseller", "admin", "super_admin"] },
  { name: "expenses-card.expenses", label: "Expenses", group: "Expenses", roles: ["customer", "reseller", "subreseller", "admin", "super_admin"] },
  { name: "export.data-export-backup", label: "Data export & backup", group: "Export", roles: ["super_admin"] },
  { name: "go-live-card.go-live", label: "Go Live", group: "Go Live", roles: ["customer", "reseller", "subreseller", "admin", "super_admin"] },
  { name: "go-live.demo-shop-not-live-yet", label: "Demo shop \u2014 not live yet", group: "Go Live", roles: ["admin"] },
  { name: "go-live.go-live", label: "Go Live", group: "Go Live", roles: ["admin"] },
  { name: "go-live.your-shop-is-live", label: "Your shop is live", group: "Go Live", roles: ["admin"] },
  { name: "go-live-requests-card.go-live-payments", label: "Go Live payments", group: "Go Live Requests", roles: ["super_admin"] },
  { name: "guide.faqs", label: "FAQs", group: "Guide", roles: ["super_admin"] },
  { name: "guide.public-guide-sections", label: "Public guide sections", group: "Guide", roles: ["super_admin"] },
  { name: "guide.visitor-questions", label: "Visitor questions", group: "Guide", roles: ["super_admin"] },
  { name: "hidden-posts-card.posts-hidden-from-my-shop", label: "Posts hidden from my shop", group: "Hidden Posts", roles: ["customer", "reseller", "subreseller", "admin", "super_admin"] },
  { name: "history-page.all-wallet-transactions", label: "All wallet transactions", group: "History Page", roles: ["customer", "reseller", "subreseller", "admin", "super_admin"] },
  { name: "invite-member-card.invitations", label: "Invitations", group: "Invite Member", roles: ["customer", "reseller", "subreseller", "admin", "super_admin"] },
  { name: "invite-member-card.invite-a-member-from-universe", label: "Invite a member from Universe", group: "Invite Member", roles: ["customer", "reseller", "subreseller", "admin", "super_admin"] },
  { name: "lovable-credits-card.lovable-ai-credits", label: "Lovable AI credits", group: "Lovable Credits", roles: ["super_admin"] },
  { name: "manual-credit-card.issue-coins", label: "Issue coins", group: "Manual Credit", roles: ["super_admin"] },
  { name: "member-inbox-panel.invites", label: "Invites", group: "Member Inbox", roles: ["customer", "reseller", "subreseller", "admin", "super_admin"] },
  { name: "member-inbox-panel.my-shops", label: "My shops", group: "Member Inbox", roles: ["customer", "reseller", "subreseller", "admin", "super_admin"] },
  { name: "member-invite-card.invitations-you-sent", label: "Invitations you sent", group: "Member Invite", roles: ["customer", "reseller", "subreseller", "admin", "super_admin"] },
  { name: "member-invite-card.invite-a-member", label: "Invite a member", group: "Member Invite", roles: ["customer", "reseller", "subreseller", "admin", "super_admin"] },
  { name: "members.invite-into-a-shop", label: "Invite into a shop", group: "Members", roles: ["super_admin"] },
  { name: "members-directory.members-directory", label: "Members Directory", group: "Members Directory", roles: ["super_admin"] },
  { name: "members-directory.shop-members", label: "Shop members", group: "Members Directory", roles: ["super_admin"] },
  { name: "messages-page.messages", label: "Messages", group: "Messages Page", roles: ["customer", "reseller", "subreseller", "admin", "super_admin"] },
  { name: "money-page.cash-out-cash-in", label: "Cash out & cash in", group: "Money Page", roles: ["customer", "reseller", "subreseller", "admin", "super_admin"] },
  { name: "money-page.my-cash-in-requests", label: "My cash in requests", group: "Money Page", roles: ["customer", "reseller", "subreseller", "admin", "super_admin"] },
  { name: "money-page.my-withdrawal-requests", label: "My withdrawal requests", group: "Money Page", roles: ["customer", "reseller", "subreseller", "admin", "super_admin"] },
  { name: "money-page.where-to-send-your-payment", label: "Where to send your payment", group: "Money Page", roles: ["customer", "reseller", "subreseller", "admin", "super_admin"] },
  { name: "operator-audit-panel.operator-actions", label: "Operator actions", group: "Operator Audit", roles: ["customer", "reseller", "subreseller", "admin", "super_admin"] },
  { name: "overview.shops", label: "Shops list", group: "Overview", roles: ["super_admin"] },
  { name: "overview.stats", label: "Platform figures", group: "Overview", roles: ["super_admin"] },
  { name: "points-earnings-panel.points-earnings", label: "Points earnings", group: "Points Earnings", roles: ["customer", "reseller", "subreseller", "admin", "super_admin"] },
  { name: "products.voucher-products", label: "Voucher products", group: "Products", roles: ["admin"] },
  { name: "profile-page.my-profile", label: "My profile", group: "Profile Page", roles: ["customer", "reseller", "subreseller", "admin", "super_admin"] },
  { name: "profile-page.profile", label: "Profile", group: "Profile Page", roles: ["customer", "reseller", "subreseller", "admin", "super_admin"] },
  { name: "promotion-tiers-card.promotion-tiers", label: "Promotion Tiers", group: "Promotion Tiers", roles: ["customer", "reseller", "subreseller", "admin", "super_admin"] },
  { name: "redemptions.redemption-queue", label: "Redemption queue", group: "Redemptions", roles: ["reseller", "subreseller"] },
  { name: "redemptions.verify-redemption", label: "Verify redemption", group: "Redemptions", roles: ["reseller", "subreseller"] },
  { name: "reports.coin-activity-earnings", label: "Coin activity & earnings", group: "Reports", roles: ["admin"] },
  { name: "reports.coin-movements", label: "Coin movements", group: "Reports", roles: ["reseller", "subreseller"] },
  { name: "reports.coin-movements-in-range", label: "Coin movements in range", group: "Reports", roles: ["admin"] },
  { name: "reports.credit-back-by-customer-purchase", label: "Credit-back by customer purchase", group: "Reports", roles: ["reseller", "subreseller"] },
  { name: "reports.cross-tenant-reports", label: "Cross-tenant reports", group: "Reports", roles: ["super_admin"] },
  { name: "reports.earnings-reports", label: "Earnings & reports", group: "Reports", roles: ["admin"] },
  { name: "reports.my-voucher-purchases", label: "My voucher purchases", group: "Reports", roles: ["reseller", "subreseller"] },
  { name: "reports.platform-totals", label: "Platform totals", group: "Reports", roles: ["super_admin"] },
  { name: "reports.points-activity", label: "Points activity", group: "Reports", roles: ["admin"] },
  { name: "reports.recent-platform-sales", label: "Recent platform sales", group: "Reports", roles: ["super_admin"] },
  { name: "reports.reseller-subreseller-performance", label: "Reseller & subreseller performance", group: "Reports", roles: ["admin"] },
  { name: "reports.revenue", label: "Revenue", group: "Reports", roles: ["admin"] },
  { name: "reports.sales-cashback-upline-commission", label: "Sales cashback & upline commission", group: "Reports", roles: ["reseller", "subreseller"] },
  { name: "reports.shop-performance", label: "Shop performance", group: "Reports", roles: ["super_admin"] },
  { name: "reports.voucher-sales-in-range", label: "Voucher sales in range", group: "Reports", roles: ["admin"] },
  { name: "resellers.reseller-network", label: "Reseller network", group: "Resellers", roles: ["admin"] },
  { name: "retail-orders-panel.retail-orders", label: "Retail orders", group: "Retail Orders", roles: ["customer", "reseller", "subreseller", "admin", "super_admin"] },
  { name: "retail-products-card.retail-products", label: "Retail products", group: "Retail Products", roles: ["customer", "reseller", "subreseller", "admin", "super_admin"] },
  { name: "retail-store-view.my-orders", label: "My orders", group: "Retail Store View", roles: ["customer", "reseller", "subreseller", "admin", "super_admin"] },
  { name: "retail-store-view.retail-store", label: "Retail store", group: "Retail Store View", roles: ["customer", "reseller", "subreseller", "admin", "super_admin"] },
  { name: "retail-store-view.retail-store-2", label: "Retail store", group: "Retail Store View", roles: ["customer", "reseller", "subreseller", "admin", "super_admin"] },
  { name: "retention-policy-card.transaction-history-retention", label: "Transaction history retention", group: "Retention Policy", roles: ["customer", "reseller", "subreseller", "admin", "super_admin"] },
  { name: "rewards.physical-rewards", label: "Physical rewards", group: "Rewards", roles: ["admin"] },
  { name: "rewards.redemption-history", label: "Redemption history", group: "Rewards", roles: ["admin"] },
  { name: "rewards.verify-a-redemption", label: "Verify a redemption", group: "Rewards", roles: ["admin"] },
  { name: "rewards-page.my-points", label: "My points", group: "Rewards Page", roles: ["customer", "reseller", "subreseller", "admin", "super_admin"] },
  { name: "rewards-page.my-redemptions", label: "My redemptions", group: "Rewards Page", roles: ["customer", "reseller", "subreseller", "admin", "super_admin"] },
  { name: "rewards-page.rewards-shop", label: "Rewards shop", group: "Rewards Page", roles: ["customer", "reseller", "subreseller", "admin", "super_admin"] },
  { name: "seller-earnings-panel.wallet-earnings", label: "Wallet & earnings", group: "Seller Earnings", roles: ["customer", "reseller", "subreseller", "admin", "super_admin"] },
  { name: "settings.contact-information", label: "Contact information", group: "Settings", roles: ["admin"] },
  { name: "settings.facebook-support", label: "Facebook support", group: "Settings", roles: ["admin"] },
  { name: "settings.gcash-notification-listener", label: "GCash notification listener", group: "Settings", roles: ["super_admin"] },
  { name: "settings.gcash-notification-listener-2", label: "GCash notification listener", group: "Settings", roles: ["super_admin"] },
  { name: "settings.platform-subscription-collection", label: "Platform subscription collection", group: "Settings", roles: ["super_admin"] },
  { name: "settings.platform-support", label: "Platform support", group: "Settings", roles: ["super_admin"] },
  { name: "settings.points-rule", label: "Points rule", group: "Settings", roles: ["admin"] },
  { name: "settings.shop-id-sign-up-link-address", label: "Shop ID, sign-up link & address", group: "Settings", roles: ["admin"] },
  { name: "settings.shop-identity", label: "Shop identity", group: "Settings", roles: ["admin"] },
  { name: "settings.voucher-sale-earnings", label: "Voucher sale earnings", group: "Settings", roles: ["admin"] },
  { name: "shop.available-vouchers", label: "Available vouchers", group: "Shop", roles: ["customer"] },
  { name: "shop-admin-queue.cash-in-paid-to-your-gcash", label: "Cash in paid to your GCash", group: "Shop Admin Queue", roles: ["customer", "reseller", "subreseller", "admin", "super_admin"] },
  { name: "shop-admin-queue.cash-out-requests-to-settle", label: "Cash out requests to settle", group: "Shop Admin Queue", roles: ["customer", "reseller", "subreseller", "admin", "super_admin"] },
  { name: "shop-admin-queue.settled-by-you", label: "Settled by you", group: "Shop Admin Queue", roles: ["customer", "reseller", "subreseller", "admin", "super_admin"] },
  { name: "shop-transfer-card.transfer-coins-to-another-shop", label: "Transfer Coins to Another Shop", group: "Shop Transfer", roles: ["customer", "reseller", "subreseller", "admin", "super_admin"] },
  { name: "shop-transfer-card.transfer-coins-to-another-shop-2", label: "Transfer Coins to Another Shop", group: "Shop Transfer", roles: ["customer", "reseller", "subreseller", "admin", "super_admin"] },
  { name: "shops.legacy-shops", label: "Legacy Shops", group: "Shops", roles: ["super_admin"] },
  { name: "shops.shops", label: "Shops", group: "Shops", roles: ["super_admin"] },
  { name: "shops.subscription-shops", label: "Subscription Shops", group: "Shops", roles: ["super_admin"] },
  { name: "signup-link.customer-signup-link", label: "Customer signup link", group: "Signup Link", roles: ["admin"] },
  { name: "social.reported-content", label: "Reported content", group: "Social", roles: ["admin"] },
  { name: "social.social-coin-activity", label: "Social coin activity", group: "Social", roles: ["admin"] },
  { name: "social-links-card.social-accounts-optional", label: "Social accounts (optional)", group: "Social Links", roles: ["customer", "reseller", "subreseller", "admin", "super_admin"] },
  { name: "social-page.community", label: "Community", group: "Social Page", roles: ["customer", "reseller", "subreseller", "admin", "super_admin"] },
  { name: "social-settings-card.community-social-credits", label: "Community & social credits", group: "Social Settings", roles: ["customer", "reseller", "subreseller", "admin", "super_admin"] },
  { name: "spending-tracker-page.breakdown", label: "Breakdown", group: "Spending Tracker Page", roles: ["customer", "reseller", "subreseller", "admin", "super_admin"] },
  { name: "spending-tracker-page.entries", label: "Entries", group: "Spending Tracker Page", roles: ["customer", "reseller", "subreseller", "admin", "super_admin"] },
  { name: "spending-tracker-page.spending-tracker", label: "Spending Tracker", group: "Spending Tracker Page", roles: ["customer", "reseller", "subreseller", "admin", "super_admin"] },
  { name: "store-settings-card.stores", label: "Stores", group: "Store Settings", roles: ["customer", "reseller", "subreseller", "admin", "super_admin"] },
  { name: "subresellers-panel.your-subresellers", label: "Your subresellers", group: "Subresellers", roles: ["reseller", "subreseller", "admin"] },
  { name: "subscription-plans-card.subscription-plans-rates", label: "Subscription plans & rates", group: "Subscription Plans", roles: ["super_admin"] },
  { name: "subscriptions.approval-queue", label: "Approval queue", group: "Subscriptions", roles: ["super_admin"] },
  { name: "subscriptions.decision-history", label: "Decision history", group: "Subscriptions", roles: ["super_admin"] },
  { name: "subscriptions.expiration-adjustments", label: "Expiration adjustments", group: "Subscriptions", roles: ["super_admin"] },
  { name: "subscriptions.tenant-statuses", label: "Tenant statuses", group: "Subscriptions", roles: ["super_admin"] },
  { name: "super-earnings-panel.platform-earnings", label: "Platform earnings", group: "Super Earnings", roles: ["super_admin"] },
  { name: "super-profile-page.account-preferences", label: "Account preferences", group: "Super Profile Page", roles: ["super_admin"] },
  { name: "super-profile-page.danger-zone", label: "Danger zone", group: "Super Profile Page", roles: ["super_admin"] },
  { name: "super-profile-page.platform-overview", label: "Platform overview", group: "Super Profile Page", roles: ["super_admin"] },
  { name: "super-profile-page.platform-privileges", label: "Platform privileges", group: "Super Profile Page", roles: ["super_admin"] },
  { name: "super-profile-page.profile", label: "Profile", group: "Super Profile Page", roles: ["super_admin"] },
  { name: "super-profile-page.recent-activity", label: "Recent activity", group: "Super Profile Page", roles: ["super_admin"] },
  { name: "super-profile-page.security-centre", label: "Security centre", group: "Super Profile Page", roles: ["super_admin"] },
  { name: "super-profile-page.super-admin-at-a-glance", label: "Super Admin at a glance", group: "Super Profile Page", roles: ["super_admin"] },
  { name: "transactions.transaction-history", label: "Transaction history", group: "Transactions", roles: ["admin"] },
  { name: "vouchers.setup-guide", label: "Setup guide", group: "Vouchers", roles: ["admin"] },
  { name: "vouchers.code-inventory", label: "Code inventory", group: "Vouchers", roles: ["admin"] },

  { name: "vouchers.per-product", label: "Per product", group: "Vouchers", roles: ["admin"] },
  { name: "wallet-center.contact-us-support", label: "Contact us / Support", group: "Wallet Center", roles: ["customer", "reseller", "subreseller", "admin", "super_admin"] },
  { name: "wallet-center.my-wallets", label: "My wallets", group: "Wallet Center", roles: ["customer", "reseller", "subreseller", "admin", "super_admin"] },
  { name: "wallet-center.quick-links", label: "Quick links", group: "Wallet Center", roles: ["customer", "reseller", "subreseller", "admin", "super_admin"] },
  { name: "wallet-center.send-coins", label: "Send coins", group: "Wallet Center", roles: ["customer", "reseller", "subreseller", "admin", "super_admin"] },
  { name: "wallet-center.wallet-center", label: "Wallet Center", group: "Wallet Center", roles: ["customer", "reseller", "subreseller", "admin", "super_admin"] },
  { name: "wallet-integrity-card.wallet-integrity", label: "Wallet integrity", group: "Wallet Integrity", roles: ["customer", "reseller", "subreseller", "admin", "super_admin"] },
  { name: "wallets.shop-coin-ledger", label: "Shop coin ledger", group: "Wallets", roles: ["admin"] },
  { name: "wallets.transfer-reversals", label: "Transfer reversals", group: "Wallets", roles: ["admin"] },
  { name: "wallets.wallet-management", label: "Wallet management", group: "Wallets", roles: ["admin"] },
];

export const SLOT_REGISTRY: SlotDefinition[] = SLOT_SOURCE.flatMap((s) =>
  s.roles.map((role) => ({
    id: slotIdFor(role, s.name),
    name: s.name,
    role,
    label: s.label,
    group: s.group,
  })),
);

export const slotsForRole = (role: Role): SlotDefinition[] =>
  SLOT_REGISTRY.filter((s) => s.role === role);

export const findSlot = (id: string): SlotDefinition | undefined =>
  SLOT_REGISTRY.find((s) => s.id === id);

/** Registry for a role, grouped by screen/panel, alphabetical inside each group. */
export function slotGroupsForRole(role: Role): { group: string; slots: SlotDefinition[] }[] {
  const map = new Map<string, SlotDefinition[]>();
  for (const s of slotsForRole(role)) {
    const list = map.get(s.group) ?? [];
    list.push(s);
    map.set(s.group, list);
  }
  return [...map.entries()]
    .map(([group, slots]) => ({
      group,
      slots: slots.sort((a, b) => a.label.localeCompare(b.label)),
    }))
    .sort((a, b) => a.group.localeCompare(b.group));
}

/* ------------------------------------------------------------------ */
/* Navigation                                                          */
/* ------------------------------------------------------------------ */

/** Every side-navigation entry a role has, in shipped order. */
export function tabsForRole(role: Role): NavItem[] {
  return navForRole(role).flatMap((g) => g.items);
}

/** The mobile bottom-bar entries a role has, in shipped order. */
export function bottomNavForRole(role: Role): NavItem[] {
  switch (role) {
    case "super_admin":
      return superBottomNav;
    case "admin":
      return adminBottomNav;
    case "reseller":
    case "subreseller":
      return resellerBottomNav;
    default:
      return customerBottomNav;
  }
}

export const tabLabel = (role: Role, path: string): string =>
  tabsForRole(role).find((t) => String(t.to) === path)?.label ??
  bottomNavForRole(role).find((t) => String(t.to) === path)?.label ??
  path;

const orderIndex = (order: string[] | undefined, path: string) => {
  const i = order?.indexOf(path) ?? -1;
  return i === -1 ? Number.POSITIVE_INFINITY : i;
};

const arrange = (items: NavItem[], order: string[] | undefined, hidden: Set<string>): NavItem[] =>
  items
    .filter((i) => !hidden.has(String(i.to)))
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        orderIndex(order, String(a.item.to)) - orderIndex(order, String(b.item.to)) ||
        a.index - b.index,
    )
    .map(({ item }) => item);

/**
 * Applies a role layout to the side navigation: hidden entries are dropped from
 * navigation (the route itself is untouched) and the rest follow the saved order.
 */
export function applyNavLayout(nav: Nav, layout: LayoutPayload | undefined): Nav {
  const hidden = new Set(layout?.tabs?.hidden ?? []);
  return nav
    .map((group) => ({ ...group, items: arrange(group.items, layout?.tabs?.order, hidden) }))
    .filter((g) => g.items.length > 0);
}

/** Same rules for the mobile bottom bar, using its own independent order. */
export function applyBottomNavLayout(
  items: NavItem[],
  layout: LayoutPayload | undefined,
): NavItem[] {
  return arrange(items, layout?.tabs?.bottomOrder, new Set(layout?.tabs?.hidden ?? []));
}

export const isTabHidden = (layout: LayoutPayload | undefined, path: string): boolean =>
  (layout?.tabs?.hidden ?? []).includes(path);

/* ------------------------------------------------------------------ */
/* Slot resolution                                                     */
/* ------------------------------------------------------------------ */

export interface ResolvedSlot {
  definition: SlotDefinition;
  hidden: boolean;
}

export const isSlotHidden = (layout: LayoutPayload | undefined, id: string): boolean =>
  layout?.slots?.[id]?.hidden === true;

export function resolveSlots(role: Role, layout: LayoutPayload | undefined): ResolvedSlot[] {
  return slotsForRole(role).map((definition) => ({
    definition,
    hidden: isSlotHidden(layout, definition.id),
  }));
}

export function hiddenSlots(role: Role, layout: LayoutPayload | undefined): ResolvedSlot[] {
  return resolveSlots(role, layout).filter((s) => s.hidden);
}

/**
 * How one slot should render. "visible" renders normally; "concealed" keeps the
 * block mounted but out of view, so it keeps processing data in the background.
 */
export function originPresentation(
  slotId: string,
  layout: LayoutPayload | undefined,
): "visible" | "concealed" {
  return isSlotHidden(layout, slotId) ? "concealed" : "visible";
}

/* ------------------------------------------------------------------ */
/* Mutations — pure; every one returns a NEW payload                   */
/* ------------------------------------------------------------------ */

export const setSlotHidden = (layout: LayoutPayload, id: string, hidden: boolean): LayoutPayload => ({
  ...layout,
  slots: { ...(layout.slots ?? {}), [id]: { ...(layout.slots?.[id] ?? {}), hidden } },
});

export function setTabHidden(layout: LayoutPayload, path: string, hidden: boolean): LayoutPayload {
  const current = new Set(layout.tabs?.hidden ?? []);
  if (hidden) current.add(path);
  else current.delete(path);
  return { ...layout, tabs: { ...(layout.tabs ?? {}), hidden: [...current] } };
}

export function setTabOrder(layout: LayoutPayload, order: string[]): LayoutPayload {
  return { ...layout, tabs: { ...(layout.tabs ?? {}), order } };
}

export function setBottomOrder(layout: LayoutPayload, order: string[]): LayoutPayload {
  return { ...layout, tabs: { ...(layout.tabs ?? {}), bottomOrder: order } };
}

const step = (list: string[], path: string, direction: -1 | 1): string[] | null => {
  const from = list.indexOf(path);
  const to = from + direction;
  if (from === -1 || to < 0 || to >= list.length) return null;
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
};

/** Moves a side-navigation entry one step. Bottom navigation is untouched. */
export function nudgeTab(
  layout: LayoutPayload,
  role: Role,
  path: string,
  direction: -1 | 1,
): LayoutPayload {
  const current = applyNavLayout(navForRole(role), { ...layout, tabs: { ...layout.tabs, hidden: [] } })
    .flatMap((g) => g.items)
    .map((i) => String(i.to));
  const next = step(current, path, direction);
  return next ? setTabOrder(layout, next) : layout;
}

/** Moves a bottom-navigation entry one step. Side navigation is untouched. */
export function nudgeBottomTab(
  layout: LayoutPayload,
  role: Role,
  path: string,
  direction: -1 | 1,
): LayoutPayload {
  const current = applyBottomNavLayout(bottomNavForRole(role), {
    ...layout,
    tabs: { ...layout.tabs, hidden: [] },
  }).map((i) => String(i.to));
  const next = step(current, path, direction);
  return next ? setBottomOrder(layout, next) : layout;
}

/** Clears every customisation for a role. */
export const resetLayout = (): LayoutPayload => ({});

/** Guards against malformed rows coming back from the database. */
export function normalizeLayout(value: unknown): LayoutPayload {
  if (!value || typeof value !== "object") return {};
  const v = value as LayoutPayload;
  const tabs = v.tabs && typeof v.tabs === "object" ? v.tabs : undefined;
  const slots = v.slots && typeof v.slots === "object" ? v.slots : undefined;
  return {
    ...(tabs
      ? {
          tabs: {
            ...(Array.isArray(tabs.order) ? { order: tabs.order.map(String) } : {}),
            ...(Array.isArray(tabs.bottomOrder)
              ? { bottomOrder: tabs.bottomOrder.map(String) }
              : {}),
            ...(Array.isArray(tabs.hidden) ? { hidden: tabs.hidden.map(String) } : {}),
          },
        }
      : {}),
    ...(slots ? { slots } : {}),
  };
}
