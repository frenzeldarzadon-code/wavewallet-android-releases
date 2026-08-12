import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Building2, Coins, CreditCard, TrendingUp, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageSection, StatCard, StatusBadge, subscriptionTone } from "@/components/ui-kit";
import { writeSession } from "@/lib/session";
import {
  accounts,
  auditEvents,
  ecosystems,
  ledger,
  peso,
  platformSettings,
  shortDateTime,
  statusLabel,
} from "@/lib/wavewallet";

export const Route = createFileRoute("/super/")({
  head: () => ({
    meta: [
      { title: "Platform Overview — WaveWallet Super Admin" },
      { name: "description", content: "Cross-tenant overview of ecosystems, subscriptions and platform revenue." },
      { property: "og:title", content: "Platform Overview — WaveWallet Super Admin" },
      { property: "og:description", content: "Cross-tenant overview of ecosystems, subscriptions and platform revenue." },
    ],
  }),
  component: SuperOverview,
});

function SuperOverview() {
  const navigate = useNavigate();
  const activeSubs = ecosystems.filter((e) => e.subscription.status === "active");
  const mrr = activeSubs.reduce((s, e) => s + e.subscription.priceMonthly, 0);
  const grossSales = ledger
    .filter((l) => l.kind === "voucher_purchase" && l.method === "credits")
    .reduce((s, l) => s + (l.grossPrice ?? 0), 0);

  const accessEcosystem = (ecosystemId: string) => {
    writeSession({ accountId: "acc_super", superAdminMode: true, ecosystemId });
    navigate({ to: "/admin" });
  };

  return (
    <>
      <PageSection>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Ecosystems" value={String(ecosystems.length)} icon={Building2} tone="brand" hint={`${activeSubs.length} active`} />
          <StatCard label="Platform MRR" value={peso(mrr)} icon={TrendingUp} tone="positive" hint="Active subscriptions only" />
          <StatCard label="Accounts" value={String(accounts.length - 1)} icon={Users} hint="Admins, resellers, customers" />
          <StatCard label="Tenant gross sales" value={peso(grossSales)} icon={Coins} hint="All ecosystems, credit sales" />
        </div>
      </PageSection>

      <PageSection title="Ecosystems" description="Each Admin owns exactly one isolated tenant.">
        <div className="grid gap-3 md:grid-cols-2">
          {ecosystems.map((eco) => {
            const admins = accounts.filter((a) => a.ecosystemId === eco.id && a.role === "admin");
            return (
              <Card key={eco.id} className="shadow-[var(--shadow-card)]">
                <CardHeader className="gap-1">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">{eco.name}</CardTitle>
                    <StatusBadge tone={subscriptionTone(eco.subscription.status)}>
                      {statusLabel[eco.subscription.status]}
                    </StatusBadge>
                  </div>
                  <p className="text-xs text-muted-foreground">{eco.description}</p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <dl className="grid grid-cols-2 gap-y-2 text-xs">
                    <div>
                      <dt className="text-muted-foreground">Admins</dt>
                      <dd className="font-medium">{admins.map((a) => a.name).join(", ") || "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Plan</dt>
                      <dd className="font-medium">
                        {eco.subscription.planName} · {peso(eco.subscription.priceMonthly)}/mo
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Customers</dt>
                      <dd className="font-medium">
                        {accounts.filter((a) => a.ecosystemId === eco.id && a.role === "customer").length}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Resellers</dt>
                      <dd className="font-medium">
                        {accounts.filter((a) => a.ecosystemId === eco.id && a.role === "reseller").length}
                      </dd>
                    </div>
                  </dl>
                  <Button size="sm" className="w-full" onClick={() => accessEcosystem(eco.id)}>
                    Access ecosystem
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </PageSection>

      <PageSection
        title="Recent platform activity"
        description="Super Admin access and platform changes are audited."
      >
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="divide-y divide-border px-0 py-0">
            {auditEvents.slice(0, 4).map((e) => (
              <div key={e.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{e.action}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {e.actor} · {e.target}
                  </p>
                </div>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {shortDateTime(e.at)}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </PageSection>

      <PageSection title="Plan configuration" description="Prices are configurable, never hard-coded.">
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <div>
              <p className="text-xs text-muted-foreground">Default plan</p>
              <p className="text-sm font-medium">{platformSettings.defaultPlanName}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Default price</p>
              <p className="text-sm font-medium text-success">
                {peso(platformSettings.defaultPlanPrice)} / month
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Grace period</p>
              <p className="text-sm font-medium">{platformSettings.defaultGraceDays} days</p>
            </div>
          </CardContent>
        </Card>
      </PageSection>

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <CreditCard className="size-3.5" /> Subscription approvals are handled in the Subscriptions tab.
      </p>
    </>
  );
}
