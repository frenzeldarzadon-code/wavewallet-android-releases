import { Outlet, createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useSession } from "@/lib/session";
import { roleLabel } from "@/lib/wavewallet";
import { resellerBottomNav, resellerNav, withBadges } from "@/lib/navigation";
import { useMemberInbox } from "@/components/member-inbox-panel";

export const Route = createFileRoute("/reseller")({
  component: ResellerLayout,
});

function ResellerLayout() {
  const session = useSession("reseller");
  const { pending } = useMemberInbox();
  if (!session.account || !session.ecosystem) return null;
  return (
    <AppShell
      session={session}
      nav={withBadges(resellerNav(session.account.role), { "/reseller/applications": pending })}
      bottomNav={resellerBottomNav}
      title={session.ecosystem.name}
      subtitle={`${roleLabel(session.account.role)} · ${session.account.name}`}
    >
      <Outlet />
    </AppShell>
  );
}
