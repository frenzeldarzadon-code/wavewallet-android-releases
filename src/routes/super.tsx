import { Outlet, createFileRoute } from "@tanstack/react-router";
import {
  BarChart3,
  Building2,
  CreditCard,
  DatabaseBackup,
  LayoutDashboard,
  ScrollText,
  Settings,
  User,
} from "lucide-react";
import { AppShell, type NavItem } from "@/components/app-shell";
import { useSession } from "@/lib/session";

export const Route = createFileRoute("/super")({
  component: SuperLayout,
});

export const superNav: NavItem[] = [
  { to: "/super", label: "Overview", icon: LayoutDashboard },
  { to: "/super/admins", label: "Ecosystems", icon: Building2 },
  { to: "/super/subscriptions", label: "Subscriptions", icon: CreditCard },
  { to: "/super/reports", label: "Reports", icon: BarChart3 },
  { to: "/super/export", label: "Data export", icon: DatabaseBackup },
  { to: "/super/audit", label: "Audit log", icon: ScrollText },
  { to: "/super/settings", label: "Platform", icon: Settings },
  { to: "/super/profile", label: "My profile", icon: User },
];


function SuperLayout() {
  const session = useSession("super_admin");
  if (!session.account) return null;
  return (
    <AppShell
      session={session}
      nav={superNav}
      title="Platform console"
      subtitle="WaveWallet Super Admin"
    >
      <Outlet />
    </AppShell>
  );
}
