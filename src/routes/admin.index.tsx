import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowRight, Coins, Link2, Ticket, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageSection, StatCard, StatusBadge, subscriptionTone } from "@/components/ui-kit";
import { useSession } from "@/lib/session";
import { supabase } from "@/integrations/supabase/client";
import { EarningsSummaryCards } from "@/components/earnings-summary-cards";
import { peso, shortDate, shortDateTime, statusLabel } from "@/lib/wavewallet";

export const Route = createFileRoute("/admin/")({
  head: () => ({
    meta: [
      { title: "Admin Dashboard — WaveWallet" },
      {
        name: "description",
        content: "Ecosystem overview: members, resellers, outstanding credits and points, subscription and recent activity.",
      },
      { property: "og:title", content: "Admin Dashboard — WaveWallet" },
      {
        property: "og:description",
        content: "Ecosystem overview: members, resellers, outstanding credits and points, subscription and recent activity.",
      },
    ],
  }),
  component: AdminDashboard,
});

interface Dash {
  member_count: number;
  customer_count: number;
  reseller_count: number;
  subreseller_count: number;
  admin_count: number;
  suspended_count: number;
  suspended_customer_count: number;
  credits_outstanding: number;
  points_outstanding: number;
}


interface AuditRow {
  id: string;
  action: string;
  target: string;
  actor_name: string;
  created_at: string;
}

function AdminDashboard() {
  const { ecosystem, ecosystemDbId } = useSession("admin");
  const [dash, setDash] = useState<Dash | null>(null);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ecosystemDbId) return;
    let active = true;
    void (async () => {
      const [{ data: d }, { data: a }] = await Promise.all([
        supabase.rpc("ecosystem_dashboard", { _ecosystem_id: ecosystemDbId }),
        supabase
          .from("audit_logs")
          .select("id, action, target, actor_name, created_at")
          .eq("ecosystem_id", ecosystemDbId)
          .order("created_at", { ascending: false })
          .limit(8),
      ]);
      if (!active) return;
      const row = Array.isArray(d) ? (d[0] as Dash | undefined) : (d as Dash | null);
      setDash(row ?? null);
      setAudit((a as AuditRow[] | null) ?? []);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [ecosystemDbId]);

  if (!ecosystem) return null;
  const sub = ecosystem.subscription;

  return (
    <>
      {sub.status !== "active" ? (
        <Card className="mb-5 border-destructive/30 bg-danger-soft shadow-none">
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 text-destructive" />
              <div>
                <p className="text-sm font-medium text-destructive">
                  Subscription {(statusLabel[sub.status] ?? sub.status).toLowerCase()}
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

      <PageSection
        title={ecosystem.name}
        description="Live figures from your ecosystem — nothing here is shared with other shops."
      >
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Members"
            value={loading ? "—" : String(dash?.member_count ?? 0)}
            icon={Users}
            tone="brand"
            hint={`${dash?.customer_count ?? 0} customers`}
          />
          <StatCard
            label="Resellers"
            value={loading ? "—" : String(dash?.reseller_count ?? 0)}
            icon={Users}
            hint={`${dash?.suspended_count ?? 0} suspended`}
          />
          <StatCard
            label="Credits outstanding"
            value={loading ? "—" : peso(Number(dash?.credits_outstanding ?? 0))}
            icon={Coins}
            tone="positive"
            hint="Held in member wallets"
          />
          <StatCard
            label="Points outstanding"
            value={loading ? "—" : `${Number(dash?.points_outstanding ?? 0)} pts`}
            icon={Coins}
            hint="Redeemable balance"
          />
        </div>
      </PageSection>

      <EarningsSummaryCards
        title="Credits generated / shop earnings"
        description="Newly issued credits recorded as shop earnings. Moving existing credits between wallets is a transfer and is never counted here."
        types={["credit_generation"]}
        ecosystemId={ecosystemDbId}
        linkTo="/admin/reports"
        linkLabel="Open earnings & financial reports"
      />



      <div className="grid gap-5 lg:grid-cols-2">
        <PageSection title="Subscription">
          <Card className="shadow-[var(--shadow-card)]">
            <CardContent className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Status</span>
                <StatusBadge tone={subscriptionTone(sub.status)}>
                  {statusLabel[sub.status] ?? sub.status}
                </StatusBadge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Plan</span>
                <span className="font-medium">
                  {sub.planName} · {peso(sub.priceMonthly)}/mo
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Period ends</span>
                <span className="font-medium">
                  {sub.currentPeriodEnd ? shortDate(sub.currentPeriodEnd) : "Not set"}
                </span>
              </div>
              <Button asChild variant="outline" size="sm" className="w-full">
                <Link to="/admin/subscription">
                  Manage subscription <ArrowRight className="size-3.5" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        </PageSection>

        <PageSection title="Voucher sales" description="Voucher engine arrives in a later stage.">
          <Card className="shadow-[var(--shadow-card)]">
            <CardContent className="space-y-2 text-center">
              <Ticket className="mx-auto size-6 text-muted-foreground" />
              <p className="text-sm font-medium">Sales reporting not available yet</p>
              <p className="text-xs text-muted-foreground">
                Voucher dispensing, credit movement and revenue reporting are not implemented, so no
                figures are shown here rather than estimated ones.
              </p>
            </CardContent>
          </Card>
        </PageSection>
      </div>

      <PageSection
        title="Recent activity"
        description="Audit trail for this ecosystem."
        action={
          <Button asChild variant="ghost" size="sm">
            <Link to="/admin/customers">
              Members <ArrowRight className="size-3.5" />
            </Link>
          </Button>
        }
      >
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="divide-y divide-border px-0 py-0">
            {audit.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                No recorded activity yet.
              </p>
            ) : (
              audit.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{a.action}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {a.actor_name}
                      {a.target ? ` · ${a.target}` : ""}
                    </p>
                  </div>
                  <p className="shrink-0 text-[11px] text-muted-foreground">
                    {shortDateTime(a.created_at)}
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </PageSection>

      <Card className="shadow-[var(--shadow-card)]">
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <Link2 className="mt-0.5 size-5 text-primary" />
            <div>
              <p className="text-sm font-medium">Customer signup link</p>
              <p className="text-xs text-muted-foreground">
                Share /join/{ecosystem.slug} to onboard customers straight into this ecosystem.
              </p>
            </div>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link to="/admin/signup-link">Open link page</Link>
          </Button>
        </CardContent>
      </Card>
    </>
  );
}
