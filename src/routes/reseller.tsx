import { Outlet, createFileRoute } from "@tanstack/react-router";
import {
  BarChart3,
  Gift,
  LayoutDashboard,
  MessageSquare,
  ShoppingCart,
  User,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import { AppShell, type NavItem } from "@/components/app-shell";
import { useSession } from "@/lib/session";
import { roleLabel } from "@/lib/wavewallet";
import { SOCIAL_ENABLED } from "@/lib/features";

export const Route = createFileRoute("/reseller")({
  component: ResellerLayout,
});

const nav: NavItem[] = [
  { to: "/reseller", label: "Dashboard", icon: LayoutDashboard },
  { to: "/reseller/shop", label: "Buy vouchers", icon: ShoppingCart },
  { to: "/reseller/customers", label: "My customers", icon: Users },
  { to: "/reseller/applications", label: "Applications", icon: UserPlus },
  ...(SOCIAL_ENABLED
    ? ([
        { to: "/reseller/social", label: "Community", icon: Users },
        { to: "/reseller/messages", label: "Messages", icon: MessageSquare },
      ] as NavItem[])
    : []),
  { to: "/reseller/redemptions", label: "Redemptions", icon: Gift },
  { to: "/reseller/reports", label: "Reports", icon: BarChart3 },
  { to: "/reseller/earnings", label: "Earnings", icon: Wallet },
  { to: "/reseller/profile", label: "My profile", icon: User },
];

function ResellerLayout() {
  const session = useSession("reseller");
  if (!session.account || !session.ecosystem) return null;
  return (
    <AppShell
      session={session}
      nav={nav}
      title={session.ecosystem.name}
      subtitle={`${roleLabel(session.account.role)} · ${session.account.name}`}
    >
      <Outlet />
    </AppShell>
  );
}
