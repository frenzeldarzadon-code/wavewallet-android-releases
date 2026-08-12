import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowRight, Coins, Ticket, TrendingUp, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageSection, StatCard, StatusBadge, subscriptionTone } from "@/components/ui-kit";
import { useSession } from "@/lib/session";
import {
  accountsIn,
  ledgerIn,
  peso,
  redemptionsIn,
  shortDateTime,
  statusLabel,
  voucherProductsIn,
} from "@/lib/wavewallet";

export const Route = createFileRoute("/admin/")({
  head: () => ({
    meta: [
      { title: "Admin Dashboard — WaveWallet" },
      { name: "description", content: "Ecosystem overview: sales, voucher stock, reseller network and pending redemptions." },
      { property: "og:title", content: "Admin Dashboard — WaveWallet" },
      { property: "og:description", content: "Ecosystem overview: sales, voucher stock, reseller network and pending redemptions." },
    ],
  }),
  component: AdminDashboard,
});

function AdminDashboard() {
  const { ecosystem } = useSession("admin");
  if (!ecosystem) return null;

  const entries = ledgerIn(ecosystem.id);
  const sales = entries.filter((l) => l.kind === "voucher_purchase");
  const gross = sales.reduce((s, l) => s + (l.grossPrice ?? 0), 0);
  const resellerEarnings = sales.reduce((s, l) => s + (l.resellerEarning ?? 0), 0);
  const products = voucherProductsIn(ecosystem.id);
  const lowStock = products.filter((p) => p.active && p.stockUnused <= 10);
  const pendingRedemptions = redemptionsIn(ecosystem.id).filter((r) => r.status === "pending");
  const resellers = accountsIn(ecosystem.id, "reseller");
  const customers = accountsIn(ecosystem.id, "customer");

  return (
    <>
      {ecosystem.subscription.status !== "active" ? (
        <Card className="mb-5 border-destructive/30 bg-danger-soft shadow-none">
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 text-destructive" />
              <div>
                <p className="text-sm font-medium text-destructive">
                  Subscription {statusLabel[ecosystem.subscription.status].toLowerCase()}
                </p>
                <p className="text-xs text-muted-foreground">
                  Selling is restricted until the platform approves your payment. Your data is kept
                  intact.
                </p>
              </div>
            </div>
            <Button asChild size="sm">
              <Link to="/admin/subscription">Open subscription</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <PageSection>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Gross sales" value={peso(gross)} icon={TrendingUp} tone="positive" hint="All recorded sales" />
          <StatCard label="Reseller earnings" value={peso(resellerEarnings)} icon={Coins} tone="negative" hint="Captured at sale time" />
          <StatCard label="Net revenue" value={peso(gross - resellerEarnings)} icon={Coins} tone="brand" />
          <StatCard label="Vouchers sold" value={String(sales.length)} icon={Ticket} />
        </div>
      </PageSection>

      <div className="grid gap-5 lg:grid-cols-2">
        <PageSection
          title="Stock alerts"
          description="Unused codes remaining per product."
          action={
            <Button asChild variant="ghost" size="sm">
              <Link to="/admin/vouchers">
                Import codes <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          }
        >
          <Card className="shadow-[var(--shadow-card)]">
            <CardContent className="divide-y divide-border px-0 py-0">
              {(lowStock.length ? lowStock : products.slice(0, 3)).map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{p.name}</p>
                    <p className="text-xs text-muted-foreground">{peso(p.creditPrice)} credits</p>
                  </div>
                  <StatusBadge tone={p.stockUnused === 0 ? "danger" : p.stockUnused <= 10 ? "warning" : "success"}>
                    {p.stockUnused} unused
                  </StatusBadge>
                </div>
              ))}
            </CardContent>
          </Card>
        </PageSection>

        <PageSection
          title="Pending reward redemptions"
          description="Points are held until approved."
          action={
            <Button asChild variant="ghost" size="sm">
              <Link to="/admin/rewards">
                Manage <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          }
        >
          <Card className="shadow-[var(--shadow-card)]">
            <CardContent className="divide-y divide-border px-0 py-0">
              {pendingRedemptions.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                  Nothing awaiting approval.
                </p>
              ) : (
                pendingRedemptions.map((r) => (
                  <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{r.rewardName}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.accountName} · {r.code}
                      </p>
                    </div>
                    <StatusBadge tone="points">{r.pointsHeld} pts held</StatusBadge>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </PageSection>
      </div>

      <PageSection title="Network" description="Accounts inside this ecosystem only.">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Resellers" value={String(resellers.length)} icon={Users} tone="brand" />
          <StatCard label="Customers" value={String(customers.length)} icon={Users} />
          <StatCard
            label="Reseller float"
            value={peso(resellers.reduce((s, r) => s + r.creditBalance, 0))}
            tone="positive"
          />
          <StatCard
            label="Customer credits"
            value={peso(customers.reduce((s, r) => s + r.creditBalance, 0))}
            tone="positive"
          />
        </div>
      </PageSection>

      <PageSection title="Latest transactions">
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="divide-y divide-border px-0 py-0">
            {entries.slice(0, 6).map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {t.productName ?? t.kind.replaceAll("_", " ")}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {t.accountName} · {t.id}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className={t.amount < 0 ? "text-sm font-medium text-destructive" : "text-sm font-medium text-success"}>
                    {t.amount < 0 ? "−" : "+"}
                    {t.method === "points" ? `${Math.abs(t.amount)} pts` : peso(t.amount)}
                  </p>
                  <p className="text-[11px] text-muted-foreground">{shortDateTime(t.createdAt)}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </PageSection>

      <p className="text-xs text-muted-foreground">
        Subscription status:{" "}
        <StatusBadge tone={subscriptionTone(ecosystem.subscription.status)}>
          {statusLabel[ecosystem.subscription.status]}
        </StatusBadge>
      </p>
    </>
  );
}
