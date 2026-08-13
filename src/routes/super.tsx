import { useEffect, useState } from "react";
import { Outlet, createFileRoute } from "@tanstack/react-router";
import {
  BarChart3,
  Building2,
  CreditCard,
  DatabaseBackup,
  LayoutDashboard,
  ScrollText,
  UserCheck,
  UserPlus,
  Settings,
  User,
  Coins,
} from "lucide-react";
import { AppShell, type NavItem } from "@/components/app-shell";
import { useSession } from "@/lib/session";
import { fetchPendingOrderCount } from "@/lib/credit-management";

export const Route = createFileRoute("/super")({
  component: SuperLayout,
});

export const superNav: NavItem[] = [
  { to: "/super", label: "Overview", icon: LayoutDashboard },
  { to: "/super/admins", label: "Ecosystems", icon: Building2 },
  { to: "/super/applications", label: "Applications", icon: UserPlus },
  { to: "/super/credits", label: "Credit management", icon: Coins },
  { to: "/super/subscriptions", label: "Subscriptions", icon: CreditCard },
  { to: "/super/reports", label: "Reports", icon: BarChart3 },
  { to: "/super/export", label: "Data export", icon: DatabaseBackup },
  { to: "/super/audit", label: "Audit log", icon: ScrollText },
  { to: "/super/operator-log", label: "Operator actions", icon: UserCheck },
  { to: "/super/settings", label: "Platform", icon: Settings },
  { to: "/super/profile", label: "My profile", icon: User },
];


function SuperLayout() {
  const session = useSession("super_admin");
  const [pending, setPending] = useState(0);

  useEffect(() => {
    if (!session.account) return;
    void fetchPendingOrderCount().then(setPending);
  }, [session.account]);

  if (!session.account) return null;
  const nav = superNav.map((item) =>
    item.to === "/super/credits" && pending > 0 ? { ...item, badge: pending } : item,
  );
  return (
    <AppShell
      session={session}
      nav={nav}
      title="Platform console"
      subtitle="WaveWallet Super Admin"
    >
      <Outlet />
    </AppShell>
  );
}
