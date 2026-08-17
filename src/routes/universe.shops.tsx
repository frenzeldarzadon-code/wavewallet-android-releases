/**
 * Shop directory — the Universe view of which ecosystems you belong to and
 * which you can ask to join. Roles, wallets and history are never shown here:
 * they belong inside the shop console, isolated per ecosystem.
 */
import { Link, createFileRoute } from "@tanstack/react-router";
import { Check, Loader2, Store } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState, PageSection } from "@/components/ui-kit";
import { ShopInvitationsCard } from "@/components/universe/shop-invitations-card";
import { UniverseShell } from "@/components/universe/universe-shell";
import { homeFor, useSession } from "@/lib/session";
import {
  fetchJoinableEcosystems,
  fetchMyMemberships,
  requestJoinEcosystem,
  switchEcosystem,
  switchableMemberships,
  type JoinableEcosystem,
  type Membership,
} from "@/lib/memberships";
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
  const [joinable, setJoinable] = useState<JoinableEcosystem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setMemberships(await fetchMyMemberships());
    setJoinable(await fetchJoinableEcosystems());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const mine = switchableMemberships(memberships);

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
    <UniverseShell title="Shops" subtitle="Your memberships and the directory">
      <div className="space-y-6 px-4 sm:px-0">
        <ShopInvitationsCard onChanged={() => void load()} />

        <PageSection
          title="Your shops"
          description="Each membership keeps its own role, wallet and history. Switching only changes which one is active."
        >
          {mine.length === 0 ? (
            <EmptyState
              title="No shop memberships yet"
              description="Join a shop below — your wallet in that shop opens right away."
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
                    {busy === m.ecosystemId ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : null}
                    {m.isActive ? "Open" : "Switch & open"}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </PageSection>

        <PageSection
          title="Discover shops"
          description="Joining is automatic — the shop admin reviews new members afterwards. Joining never grants a role by itself."
        >
          {joinable.length === 0 ? (
            <EmptyState title="No other shops are open for joining right now" />
          ) : (
            <div className="space-y-2">
              {joinable.map((e) => (
                <div
                  key={e.id}
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{e.name}</p>
                    <p className="line-clamp-2 text-xs text-muted-foreground">
                      {e.description ?? "Hotspot shop"}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={e.pending || busy === e.id}
                    onClick={async () => {
                      setBusy(e.id);
                      try {
                        await requestJoinEcosystem(e.id);
                        toast.success("You joined the shop — your wallet there is ready.");
                        await load();
                      } catch (err) {
                        toast.error(
                          err instanceof Error ? err.message : "Could not send the request",
                        );
                      } finally {
                        setBusy(null);
                      }
                    }}
                  >
                    {e.pending ? "In review" : "Join shop"}
                  </Button>
                </div>
              ))}
            </div>
          )}
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
