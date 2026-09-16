/**
 * Platform owner → Points cost. An accounting audit view of the rule
 * "1 reward point = 1 Universe coin of cost to the shop Admin", applied to the
 * points members already earned before the rule existed.
 *
 * It never edits points: it reads the authoritative points history, shows what
 * each shop's Admin owes for it, and can post the one-off coin adjustment.
 * Re-running is safe — every historical award is recorded as charged once.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Coins, Gauge, ListChecks, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, PageSection, StatCard, StatusBadge } from "@/components/ui-kit";
import { useSession } from "@/lib/session";
import { peso, shortDateTime } from "@/lib/wavewallet";
import { formatPoints } from "@/lib/points";
import {
  fetchPointsCostReport,
  fetchPointsCostRuns,
  fetchPointsCostUnresolved,
  reconciliationStatusLabel,
  reconciliationTone,
  runPointsCostReconciliation,
  shopReconciles,
  totals,
  type PointsCostRun,
  type PointsCostShop,
  type PointsCostUnresolved,
} from "@/lib/points-cost-reconciliation";

export const Route = createFileRoute("/super/points-cost")({
  head: () => ({
    meta: [
      { title: "Points Cost — ONE WAVE Super Admin" },
      {
        name: "description",
        content:
          "Audit how the reward points members already earned are charged to each shop admin at one point per coin, including anything still unresolved.",
      },
      { property: "og:title", content: "Points Cost — ONE WAVE Super Admin" },
      {
        property: "og:description",
        content:
          "Audit how already-earned reward points are charged to each shop admin at one point per coin.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SuperPointsCostPage,
});

function SuperPointsCostPage() {
  useSession("super_admin");

  const [shops, setShops] = useState<PointsCostShop[]>([]);
  const [unresolved, setUnresolved] = useState<PointsCostUnresolved[]>([]);
  const [runs, setRuns] = useState<PointsCostRun[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [report, unres, history] = await Promise.all([
        fetchPointsCostReport(),
        fetchPointsCostUnresolved(),
        fetchPointsCostRuns(),
      ]);
      setShops(report);
      setUnresolved(unres);
      setRuns(history);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load the points cost report");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (dryRun: boolean) => {
    setBusy(true);
    try {
      const rows = await runPointsCostReconciliation(dryRun);
      const charged = Math.round(rows.reduce((t, r) => t + r.amountDebited, 0) * 100) / 100;
      const short = Math.round(rows.reduce((t, r) => t + r.shortfall, 0) * 100) / 100;
      if (rows.length === 0) {
        toast.success("Nothing left to charge — every earned point is already accounted for.");
      } else if (dryRun) {
        toast.success(`Preview: ${peso(charged)} would be charged across ${rows.length} shop(s).`);
      } else {
        toast.success(`Charged ${peso(charged)} across ${rows.length} shop(s).`);
      }
      if (short > 0) toast.warning(`${peso(short)} could not be charged and stays outstanding.`);
      if (!dryRun) await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The reconciliation could not be completed");
    } finally {
      setBusy(false);
    }
  };

  const sum = totals(shops);

  return (
    <div className="space-y-6">
      <PageSection
        devSlot="super-points-cost.overview"
        title="Points cost"
        description="Every reward point a member earned costs the shop admin one coin. This page charges that cost for the points earned before the rule existed. Members keep every point they earned — their balances and history are never changed."
      >
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Points earned in shops" value={formatPoints(sum.historicalPoints)} icon={Sparkles} />
          <StatCard label="Already charged" value={peso(sum.chargedCoins)} icon={Coins} />
          <StatCard label="Still to charge" value={peso(sum.pendingCoins)} icon={Gauge} />
          <StatCard label="Shops with points" value={String(sum.shops)} icon={ListChecks} />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void act(true)} disabled={busy}>
            Preview
          </Button>
          <Button onClick={() => void act(false)} disabled={busy}>
            {busy ? "Working…" : "Charge outstanding points"}
          </Button>
          <Button variant="ghost" onClick={() => void load()} disabled={busy}>
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh
          </Button>
        </div>
      </PageSection>

      <PageSection
        devSlot="super-points-cost.shops"
        title="By shop"
        description="Historical points for each shop, the coin equivalent, what has been charged to its admin and anything still outstanding."
      >
        {loading ? (
          <EmptyState title="Loading…" description="Reading the reward history." />
        ) : shops.length === 0 ? (
          <EmptyState title="No shops" description="No shop has earned reward points yet." />
        ) : (
          <div className="space-y-3">
            {shops.map((s) => (
              <Card key={s.ecosystemId} className="shadow-[var(--shadow-card)]">
                <CardContent className="space-y-2 px-4 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{s.shopName}</p>
                      <p className="text-xs text-muted-foreground">
                        Admin: {s.adminName ?? "not assigned"}
                      </p>
                    </div>
                    <StatusBadge tone={reconciliationTone(s.status)}>
                      {reconciliationStatusLabel(s.status)}
                    </StatusBadge>
                  </div>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                    <Row label="Points earned" value={formatPoints(s.historicalPoints)} />
                    <Row label="Coin equivalent" value={peso(s.historicalPoints)} />
                    <Row label="Charged" value={peso(s.chargedCoins)} />
                    <Row label="Still to charge" value={peso(s.pendingPoints)} />
                    <Row label="Outstanding shortfall" value={peso(s.shortfallCoins)} />
                    <Row label="Admin coins available" value={peso(s.adminAvailable)} />
                  </dl>
                  {!shopReconciles(s) && (
                    <p className="text-xs text-destructive">
                      Charged and outstanding amounts do not add up to the earned points — review before charging.
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </PageSection>

      <PageSection
        devSlot="super-points-cost.unresolved"
        title="Unresolved points"
        description="Points that cannot be attributed to a shop admin safely. Nothing is charged for these."
      >
        {unresolved.length === 0 ? (
          <EmptyState title="Nothing unresolved" description="Every earned point belongs to a shop with an admin." />
        ) : (
          <Card className="shadow-[var(--shadow-card)]">
            <CardContent className="divide-y divide-border px-0 py-0">
              {unresolved.map((u, i) => (
                <div key={`${u.bucket}-${i}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{u.detail}</p>
                    <p className="text-xs text-muted-foreground">{u.entries} record(s)</p>
                  </div>
                  <span className="text-sm font-medium">{formatPoints(u.points)} pts</span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </PageSection>

      <PageSection
        devSlot="super-points-cost.runs"
        title="Adjustment history"
        description="Every charge posted by this page, kept as an audit record."
      >
        {runs.length === 0 ? (
          <EmptyState title="No adjustments yet" description="Nothing has been charged so far." />
        ) : (
          <Card className="shadow-[var(--shadow-card)]">
            <CardContent className="divide-y divide-border px-0 py-0">
              {runs.map((r) => (
                <div key={r.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{r.shopName}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.adminName ?? "no admin"} · {formatPoints(r.pointsTotal)} pts · {r.entriesCount} record(s)
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium">{peso(r.amountDebited)}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {reconciliationStatusLabel(r.status)} · {shortDateTime(r.createdAt)}
                    </p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </PageSection>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
