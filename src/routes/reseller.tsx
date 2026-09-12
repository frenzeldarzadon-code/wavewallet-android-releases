import { Outlet, createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useSession } from "@/lib/session";
import { roleLabel } from "@/lib/wavewallet";
import { resellerBottomNavFor, resellerNav, withBadges } from "@/lib/navigation";
import { useMemberInbox } from "@/components/member-inbox-panel";
import { useShopStatus } from "@/lib/shop-status";

export const Route = createFileRoute("/reseller")({
  component: ResellerLayout,
});

function ResellerLayout() {
  const session = useSession("reseller");
  const { pending } = useMemberInbox();
  const shopStatus = useShopStatus(session.ecosystemDbId);
  if (!session.account || !session.ecosystem) return null;
  return (
    <AppShell
      session={session}
      nav={withBadges(resellerNav(session.account.role, shopStatus.shopType), {
        "/reseller/applications": pending,
      })}
      bottomNav={resellerBottomNavFor(shopStatus.shopType)}
      title={session.ecosystem.name}
      subtitle={`${roleLabel(session.account.role)} · ${session.account.name}`}
    >
      <Outlet />
    </AppShell>
  );
}
