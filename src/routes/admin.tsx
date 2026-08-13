import { Navigate, Outlet, createFileRoute, useRouterState } from "@tanstack/react-router";
import {
  BarChart3,
  Coins,
  CreditCard,
  Gift,
  LayoutDashboard,
  Link2,
  MessagesSquare,
  Package,
  ReceiptText,
  Settings,
  Wallet,
  Ticket,
  User,
  Users,
  UserSquare2,
} from "lucide-react";
import { AppShell, type NavItem } from "@/components/app-shell";
import { useSession } from "@/lib/session";
import { SOCIAL_ENABLED } from "@/lib/features";

export const Route = createFileRoute("/admin")({
  component: AdminLayout,
});

const nav: NavItem[] = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { to: "/admin/products", label: "Voucher products", icon: Package },
  { to: "/admin/vouchers", label: "Code inventory", icon: Ticket },
  { to: "/admin/wallets", label: "Wallets", icon: Wallet },
  { to: "/admin/shop", label: "Voucher shop", icon: Ticket },
  { to: "/admin/credits", label: "Shop credits", icon: Coins },
  { to: "/admin/transactions", label: "Transactions", icon: ReceiptText },
  { to: "/admin/rewards", label: "Rewards", icon: Gift },
  { to: "/admin/resellers", label: "Resellers", icon: Users },
  { to: "/admin/customers", label: "Customers", icon: UserSquare2 },
  ...(SOCIAL_ENABLED
    ? ([{ to: "/admin/social", label: "Community", icon: MessagesSquare }] as NavItem[])
    : []),
  { to: "/admin/signup-link", label: "Customer signup link", icon: Link2 },
  { to: "/admin/reports", label: "Reports", icon: BarChart3 },
  { to: "/admin/settings", label: "Ecosystem", icon: Settings },
  { to: "/admin/profile", label: "My profile", icon: User },
];


// Subscription plan management is not part of the Admin console. The screen
// stays reachable only while the shop is locked out, so a lapsed admin can
// still renew — it is never offered as a normal navigation tab.
const renewNav: NavItem = { to: "/admin/subscription", label: "Renew access", icon: CreditCard };

const bottomNav: NavItem[] = [
  { to: "/admin", label: "Home", icon: LayoutDashboard },
  { to: "/admin/products", label: "Products", icon: Package },
  { to: "/admin/vouchers", label: "Codes", icon: Ticket },
  { to: "/admin/wallets", label: "Wallets", icon: Wallet },
  { to: "/admin/reports", label: "Reports", icon: BarChart3 },
];

function AdminLayout() {
  const session = useSession("admin");
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (!session.account || !session.ecosystem) return null;

  // Subscription gate: a lapsed tenant keeps read-only access (dashboard, reports)
  // and the subscription screen. Every write is refused by the database through
  // require_operational(); this is UX only and never the security boundary.
  const gated = !session.subscriptionOk && session.account.role !== "super_admin";
  const readOnlyPaths = ["/admin", "/admin/reports", "/admin/subscription"];
  if (gated && !readOnlyPaths.includes(pathname)) {
    return <Navigate to="/admin/subscription" replace />;
  }

  return (
    <AppShell
      session={session}
      nav={gated ? [...nav.filter((i) => readOnlyPaths.includes(i.to)), renewNav] : nav}
      bottomNav={gated ? [] : bottomNav}
      title={session.ecosystem.name}
      subtitle="Admin console"
    >
      <Outlet />
    </AppShell>
  );
}
