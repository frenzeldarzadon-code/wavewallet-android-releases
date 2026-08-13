import { Navigate, Outlet, createFileRoute, useRouterState } from "@tanstack/react-router";
import { CreditCard } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { useSession } from "@/lib/session";
import { adminBottomNav, adminGatedPaths, adminNav, restrictNav, type NavItem } from "@/lib/navigation";

export const Route = createFileRoute("/admin")({
  component: AdminLayout,
});

// Subscription plan management is not part of the Admin console. The screen
// stays reachable only while the shop is locked out, so a lapsed admin can
// still renew — it is never offered as a normal navigation tab.
const renewNav: NavItem = { to: "/admin/subscription", label: "Renew access", icon: CreditCard };

function AdminLayout() {
  const session = useSession("admin");
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (!session.account || !session.ecosystem) return null;

  // Subscription gate: a lapsed tenant keeps read-only access (dashboard, reports)
  // and the subscription screen. Every write is refused by the database through
  // require_operational(); this is UX only and never the security boundary.
  const gated = !session.subscriptionOk && session.account.role !== "super_admin";
  if (gated && !adminGatedPaths.includes(pathname)) {
    return <Navigate to="/admin/subscription" replace />;
  }

  const nav = adminNav();
  return (
    <AppShell
      session={session}
      nav={gated ? restrictNav(nav, adminGatedPaths, renewNav) : nav}
      bottomNav={gated ? [] : adminBottomNav}
      title={session.ecosystem.name}
      subtitle="Admin console"
    >
      <Outlet />
    </AppShell>
  );
}
