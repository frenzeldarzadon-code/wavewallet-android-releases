import { Outlet, createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useSession } from "@/lib/session";
import { customerBottomNav, customerNav, withBadges } from "@/lib/navigation";
import { useMemberInbox } from "@/components/member-inbox-panel";

export const Route = createFileRoute("/app")({
  component: CustomerLayout,
});

function CustomerLayout() {
  const session = useSession("customer");
  const { pending } = useMemberInbox();
  if (!session.account || !session.ecosystem) return null;
  return (
    <AppShell
      session={session}
      nav={withBadges(customerNav(), { "/app/applications": pending })}
      bottomNav={customerBottomNav}
      title={session.ecosystem.name}
      subtitle={`Hi, ${session.account.name.split(" ")[0]}`}
    >
      <Outlet />
    </AppShell>
  );
}
