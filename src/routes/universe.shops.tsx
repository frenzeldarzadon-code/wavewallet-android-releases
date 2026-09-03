/**
 * Shop directory — the Universe view of which ecosystems you belong to and
 * which you can ask to join. Roles, wallets and history are never shown here:
 * they belong inside the shop console, isolated per ecosystem.
 */
import { Link, createFileRoute } from "@tanstack/react-router";
import { Check, Loader2, Plus, Store } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState, PageSection } from "@/components/ui-kit";
import { ShopInvitationsCard } from "@/components/universe/shop-invitations-card";
import { UniverseShell } from "@/components/universe/universe-shell";
import { UniverseShopDiscovery } from "@/components/universe/universe-shop-discovery";
import { homeFor, useSession } from "@/lib/session";
import {
  fetchMyMemberships,
  switchEcosystem,
  switchableMemberships,
  type Membership,
} from "@/lib/memberships";
import { ShopFinder } from "@/components/shop/shop-finder";
import { joinShopByCode, type ShopSummary } from "@/lib/shop-directory";
import { roleLabels } from "@/lib/wavewallet";

export const Route = createFileRoute("/universe/shops")({
  head: () => ({
    meta: [
      { title: "Shop Directory — WaveWallet Universe" },
      {
        name: "description",
        content:
          "Browse WaveWallet shops, switch between the ones you belong to and join a new hotspot shop instantly.",
      },
      { property: "og:title", content: "Shop Directory — WaveWallet Universe" },
      {
        property: "og:description",
        content: "Switch between your shops or join a new one instantly.",
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
  const [found, setFound] = useState<ShopSummary | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const list = await fetchMyMemberships();
    setMemberships(list);
    // Type labels so several shops are told apart at a glance.
    setTypes(await fetchShopTypes(list.map((m) => m.ecosystemId)));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const mine = switchableMemberships(memberships);
  const managed = mine.filter((m) => m.role === "admin").length;

  const enter = async (ecosystemId: string, isActive: boolean) => {
    if (busy) return;
    setBusy(ecosystemId);
    try {
      if (!isActive) await switchEcosystem(ecosystemId);
      // Reload so every wallet, list and report refetches in the new context.
      window.location.href = homeFor(session.account?.role ?? "customer");
    } catch (e) {
      setBusy(null);
      toast.error(e instanceof Error ? e.message : "Could not switch shop");
    }
  };

  return (
    <UniverseShell title="Shops" subtitle="Find vouchers, your shops, and joining another one">
      <div className="space-y-6 px-4 sm:px-0">
        {session.account ? (
          <PageSection
            title="Find a Universe shop or seller"
            description="Search by shop or voucher name, then pick a seller and buy from their storefront — paid from your Universe wallet, no membership needed."
          >
            <UniverseShopDiscovery />
          </PageSection>
        ) : null}

        <ShopInvitationsCard onChanged={() => void load()} />

        <PageSection
          title="Your shops"
          description="Each membership keeps its own role, wallet and history. Switching only changes which one is active."
        >
          {mine.length === 0 ? (
            <EmptyState
              title="No shop memberships yet"
              description="Join a shop with its 7-digit Shop ID below, or create your own."
            />
          ) : (
            <div className="space-y-2">
              {mine.map((m) => (
                <div
                  key={m.ecosystemId}
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3"
                >
                  <Store className="size-5 text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{m.ecosystemName}</p>
                    <p className="text-xs text-muted-foreground">
                      {roleLabels[m.role]}
                      {m.isActive ? " · active" : ""}
                    </p>
                  </div>
                  {m.isActive ? (
                    <Check className="size-4 text-success" aria-label="Active shop" />
                  ) : null}
                  <Button
                    size="sm"
                    variant={m.isActive ? "default" : "outline"}
                    disabled={busy === m.ecosystemId}
                    onClick={() => void enter(m.ecosystemId, m.isActive)}
                  >
                    {busy === m.ecosystemId ? <Loader2 className="size-4 animate-spin" /> : null}
                    {m.isActive ? "Open" : "Switch & open"}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </PageSection>

        <PageSection
          title="Search & join an existing shop"
          description="Enter the operator's 7-digit Shop ID, or find them by city / municipality. Shops you do not belong to stay private."
        >
          <div className="space-y-3 rounded-xl border border-border bg-card p-4">
            <ShopFinder value={found} onChange={setFound} />
            <Button
              className="w-full"
              disabled={!found || busy === "join"}
              onClick={async () => {
                if (!found) return;
                setBusy("join");
                try {
                  await joinShopByCode(found.shopCode);
                  toast.success("You joined the shop — your wallet there is ready.");
                  setFound(null);
                  await load();
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Could not join that shop");
                } finally {
                  setBusy(null);
                }
              }}
            >
              {busy === "join" ? <Loader2 className="size-4 animate-spin" /> : null}
              Join shop
            </Button>
          </div>
        </PageSection>

        <PageSection
          title="Create a new shop"
          description="Run your own WiFi voucher operation — set up your shop and go live when you are ready."
        >
          <Button asChild variant="outline" className="w-full">
            <Link to="/start-shop">
              <Plus className="size-4" />
              Create New Shop
            </Link>
          </Button>
        </PageSection>

        <p className="text-xs text-muted-foreground">
          Looking for balances, vouchers or reports?{" "}
          <Link
            to={homeFor(session.account?.role ?? "customer")}
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            Open your shop console
          </Link>
          .
        </p>
      </div>
    </UniverseShell>
  );
}
