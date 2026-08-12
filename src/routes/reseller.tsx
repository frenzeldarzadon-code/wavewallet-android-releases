import { Outlet, createFileRoute } from "@tanstack/react-router";
import { BarChart3, Gift, LayoutDashboard, ShoppingCart, Users } from "lucide-react";
import { AppShell, type NavItem } from "@/components/app-shell";
import { useSession } from "@/lib/session";
import { roleLabel } from "@/lib/wavewallet";

export const Route = createFileRoute("/reseller")({
  component: ResellerLayout,
});

const nav: NavItem[] = [
  { to: "/reseller", label: "Dashboard", icon: LayoutDashboard },
  { to: "/reseller/shop", label: "Buy vouchers", icon: ShoppingCart },
  { to: "/reseller/customers", label: "My customers", icon: Users },
  { to: "/reseller/redemptions", label: "Redemptions", icon: Gift },
  { to: "/reseller/reports", label: "Earnings", icon: BarChart3 },
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
