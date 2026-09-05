/**
 * Shops — the Universe view of the shop world.
 *
 * Universe is the customer portal: a Universe member is already a customer of
 * every Universe shop, so there is nothing to join or request. This screen is
 * for finding shops and sellers to buy from, answering team invitations, and
 * — only for members who hold a management role somewhere — opening the Shop
 * Dashboard of a shop they run. Roles, wallets and history of a shop are never
 * shown here: they belong inside that shop's dashboard.
 */
import { Link, createFileRoute } from "@tanstack/react-router";
import { Check, Loader2, Plus, Settings2, ShoppingBag, Store } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageSection } from "@/components/ui-kit";
import { ShopInvitationsCard } from "@/components/universe/shop-invitations-card";
import { UniverseShell } from "@/components/universe/universe-shell";
import { UniverseShopDiscovery } from "@/components/universe/universe-shop-discovery";
import { openShopDashboard } from "@/components/shop/shop-dashboard-switch";
import { useSession } from "@/lib/session";
import { fetchMyMemberships, type Membership } from "@/lib/memberships";
import { dashboardLabelFor, managedMemberships } from "@/lib/shop-dashboard";
import { ShopTypeBadge } from "@/components/shop/shop-type-card";
import { SHOP_TYPE_INFO, SHOP_TYPES, fetchShopTypes, type ShopTypeState } from "@/lib/shop-type";

export const Route = createFileRoute("/universe/shops")({
  head: () => ({
    meta: [
      { title: "Shops — ONE WAVE Universe" },
      {
        name: "description",
        content:
          "Find ONE WAVE shops and sellers, buy vouchers with your Universe wallet, and open the Shop Dashboard of any shop you manage.",
      },
      { property: "og:title", content: "Shops — ONE WAVE Universe" },
      {
        property: "og:description",
        content: "Find shops and sellers, or open the Shop Dashboard of a shop you manage.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: UniverseShops,
});

function UniverseShops() {
  const session = useSession();
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [types, setTypes] = useState<Record<string, ShopTypeState>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const list = await fetchMyMemberships();
    setMemberships(list);
    // Type labels so several shops are told apart at a glance.
    setTypes(await fetchShopTypes(managedMemberships(list).map((m) => m.ecosystemId)));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const managed = managedMemberships(memberships);

  const enter = async (m: Membership) => {
    if (busy) return;
    setBusy(m.ecosystemId);
    try {
      await openShopDashboard(m);
    } catch (e) {
      setBusy(null);
      toast.error(e instanceof Error ? e.message : "Could not open the Shop Dashboard");
    }
  };

  return (
    <UniverseShell title="Shops" subtitle="Find vouchers and sellers — no membership needed">
      <div className="space-y-6 px-4 sm:px-0">
      {session.account ? (
          <PageSection
            title="Find a Universe shop or seller"
            description="Search by shop or voucher name, then pick a seller and buy from their storefront — paid from your Universe wallet. Being a Universe member is all you need."
          >
            <Button asChild variant="outline" className="mb-4 w-full justify-between rounded-lg">
              <Link to="/universe/products">
                Browse all products across the Universe <ShoppingBag className="size-4" />
              </Link>
            </Button>
            <UniverseShopDiscovery currentUserId={session.account.id} />
          </PageSection>
        ) : null}

        <ShopInvitationsCard onChanged={() => void load()} />

        {managed.length > 0 ? (
          <PageSection
            title="Shop Dashboard"
            description={
              managed.length > 1
                ? `You manage ${managed.length} shops. Each dashboard keeps its own sellers, inventory, storefront and history.`
                : "Shop operations, sellers, inventory and storefront design live in the Shop Dashboard."
            }
          >
            <div className="space-y-2">
              {managed.map((m) => {
                const t = types[m.ecosystemId] ?? null;
                const isNg = t === "new_generation";
                return (
                  <div
                    key={m.ecosystemId}
                    className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-[var(--shadow-card)]"
                  >
                    <Store className={isNg ? "size-5 text-warning" : "size-5 text-primary"} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{m.ecosystemName}</p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        {t ? <ShopTypeBadge type={t} /> : null}
                        <span>
                          {dashboardLabelFor(m.role)}
                          {m.isActive ? " · current" : ""}
                        </span>
                      </div>
                    </div>
                    {m.isActive ? (
                      <Check className="size-4 text-success" aria-label="Current shop" />
                    ) : null}
                    <div className="flex items-center gap-2">
                      {m.role === "admin" && m.isActive ? (
                        <Button asChild size="sm" variant="ghost">
                          <Link
                            to="/admin/storefront"
                            aria-label={`Storefront design for ${m.ecosystemName}`}
                          >
                            <Settings2 className="size-4" />
                            Storefront
                          </Link>
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant={m.isActive ? "default" : "outline"}
                        disabled={busy === m.ecosystemId}
                        onClick={() => void enter(m)}
                      >
                        {busy === m.ecosystemId ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : null}
                        Open dashboard
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </PageSection>
        ) : null}

        <PageSection
          title="Start your own shop"
          description="You can run several shops from this login. Pick the type first — it decides which tools the shop gets."
        >
          <div className="space-y-3 rounded-xl border border-border bg-card p-4">
            <ul className="space-y-1.5 text-xs text-muted-foreground">
              {SHOP_TYPES.map((t) => (
                <li key={t} className="flex gap-2">
                  <span className="shrink-0 font-semibold text-foreground">
                    {SHOP_TYPE_INFO[t].label}
                  </span>
                  <span>— {SHOP_TYPE_INFO[t].tagline}</span>
                </li>
              ))}
            </ul>
            <Button asChild variant="outline" className="w-full">
              <Link to="/start-shop">
                <Plus className="size-4" />
                Create a new shop
              </Link>
            </Button>
          </div>
        </PageSection>
      </div>
    </UniverseShell>
  );
}
