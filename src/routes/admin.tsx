import { Outlet, createFileRoute } from "@tanstack/react-router";
import {
  BarChart3,
  CreditCard,
  Gift,
  LayoutDashboard,
  Package,
  Settings,
  Ticket,
  Users,
  UserSquare2,
} from "lucide-react";
import { AppShell, type NavItem } from "@/components/app-shell";
import { useSession } from "@/lib/session";

export const Route = createFileRoute("/admin")({
  component: AdminLayout,
});

const nav: NavItem[] = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { to: "/admin/products", label: "Voucher products", icon: Package },
  { to: "/admin/vouchers", label: "Code inventory", icon: Ticket },
  { to: "/admin/rewards", label: "Rewards", icon: Gift },
  { to: "/admin/resellers", label: "Resellers", icon: Users },
  { to: "/admin/customers", label: "Customers", icon: UserSquare2 },
  { to: "/admin/reports", label: "Reports", icon: BarChart3 },
  { to: "/admin/subscription", label: "Subscription", icon: CreditCard },
  { to: "/admin/settings", label: "Ecosystem", icon: Settings },
];

const bottomNav: NavItem[] = [
  { to: "/admin", label: "Home", icon: LayoutDashboard },
  { to: "/admin/products", label: "Products", icon: Package },
  { to: "/admin/vouchers", label: "Codes", icon: Ticket },
  { to: "/admin/resellers", label: "Resellers", icon: Users },
  { to: "/admin/reports", label: "Reports", icon: BarChart3 },
];

function AdminLayout() {
  const session = useSession("admin");
  if (!session.account || !session.ecosystem) return null;
  return (
    <AppShell
      session={session}
      nav={nav}
      bottomNav={bottomNav}
      title={session.ecosystem.name}
      subtitle="Admin console"
    >
      <Outlet />
    </AppShell>
  );
}
