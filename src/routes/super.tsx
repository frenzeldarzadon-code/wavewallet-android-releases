import { useEffect, useState } from "react";
import { Outlet, createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useSession } from "@/lib/session";
import { fetchPendingOrderCount } from "@/lib/credit-management";
import { superAdminNav, superBottomNav, withBadges } from "@/lib/navigation";

export const Route = createFileRoute("/super")({
  component: SuperLayout,
});

function SuperLayout() {
  const session = useSession("super_admin");
  const [pending, setPending] = useState(0);

  const accountId = session.account?.id ?? null;
  useEffect(() => {
    if (!accountId) return;
    void fetchPendingOrderCount().then(setPending);
  }, [accountId]);

  if (!session.account) return null;
  const nav = withBadges(superAdminNav(), { "/super/approvals": pending });
  return (
    <AppShell
      session={session}
      nav={nav}
      bottomNav={superBottomNav}
      title="Platform console"
      subtitle="ONE WAVE Super Admin"
    >
      <Outlet />
    </AppShell>
  );
}
