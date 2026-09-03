import { Outlet, createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useSession } from "@/lib/session";
import { adminBottomNavFor, adminNav, withBadges } from "@/lib/navigation";
import { useMemberInbox } from "@/components/member-inbox-panel";
import { useShopStatus } from "@/lib/shop-status";
import { shopTypeLabel } from "@/lib/shop-type";
import { useEffect, useState } from "react";
import { fetchPendingRetailOrderCount } from "@/lib/retail";

/** New Retail orders waiting for approval — same nav badge system as applications. */
function usePendingRetailOrders(ecosystemId: string | null, retail: boolean) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!ecosystemId || !retail) {
      setCount(0);
      return;
    }
    let live = true;
    const tick = () =>
      fetchPendingRetailOrderCount(ecosystemId)
        .then((n) => live && setCount(n))
        .catch(() => undefined);
    void tick();
    const id = window.setInterval(tick, 60_000);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, [ecosystemId, retail]);
  return count;
}

export const Route = createFileRoute("/admin")({
  component: AdminLayout,
});

function AdminLayout() {
  const session = useSession("admin");
  const { pending } = useMemberInbox();
  const shopStatus = useShopStatus(session.ecosystemDbId);
  const newOrders = usePendingRetailOrders(
    session.ecosystemDbId,
    shopStatus.shopType === "universe_retail",
  );

  // Never render a blank screen: the session resolves asynchronously, and an
  // admin whose active shop is not resolved yet gets a readable state instead.
  if (!session.ready) return <ConsoleNotice title="Loading your console…" />;
  if (!session.account) return null;
  if (!session.ecosystem) {
    return (
      <ConsoleNotice
        title="No active shop selected"
        body="Your admin membership is not currently the active shop for this login. Open the Universe shops page to switch back into your shop."
      />
    );
  }

  // The console only offers the tools of the shop type being managed.
  const nav = withBadges(adminNav({ goLive: shopStatus.isDemo, shopType: shopStatus.shopType }), {
    "/admin/applications": pending,
    "/admin/orders": newOrders,
  });
  return (
    <AppShell
      session={session}
      nav={nav}
      bottomNav={adminBottomNavFor(shopStatus.shopType)}
      title={session.ecosystem.name}
      subtitle={
        shopStatus.shopType
          ? `${shopTypeLabel(shopStatus.shopType)} · Admin console`
          : "Admin console"
      }
    >
      <Outlet />
    </AppShell>
  );
}

/** Readable fallback while the console has no shop context to render yet. */
function ConsoleNotice({ title, body }: { title: string; body?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-app px-6">
      <div className="max-w-sm text-center">
        <p className="text-base font-semibold">{title}</p>
        {body ? <p className="mt-2 text-sm text-muted-foreground">{body}</p> : null}
      </div>
    </div>
  );
}
