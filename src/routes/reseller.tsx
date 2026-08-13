import { Outlet, createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useSession } from "@/lib/session";
import { roleLabel } from "@/lib/wavewallet";
import { resellerBottomNav, resellerNav } from "@/lib/navigation";

export const Route = createFileRoute("/reseller")({
  component: ResellerLayout,
});

function ResellerLayout() {
  const session = useSession("reseller");
  if (!session.account || !session.ecosystem) return null;
  return (
    <AppShell
      session={session}
      nav={resellerNav(session.account.role)}
      bottomNav={resellerBottomNav}
      title={session.ecosystem.name}
      subtitle={`${roleLabel(session.account.role)} · ${session.account.name}`}
    >
      <Outlet />
    </AppShell>
  );
}
