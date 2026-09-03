import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Coins, FlaskConical, Link2, Rocket, Ticket, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageSection, StatCard } from "@/components/ui-kit";
import { useSession } from "@/lib/session";
import { supabase } from "@/integrations/supabase/client";
import { AdminEarningsPanel } from "@/components/admin-earnings-panel";
import { peso, shortDateTime } from "@/lib/wavewallet";
import { useShopStatus } from "@/lib/shop-status";
import { reviewCountdown } from "@/lib/review-demo";
import { StatusBadge } from "@/components/ui-kit";
import { pts } from "@/lib/points";
import { DevSlot } from "@/components/dev/dev-slot";
import { SubscriptionCountdownCard } from "@/components/subscription/subscription-countdown-card";


export const Route = createFileRoute("/admin/")({
  head: () => ({
    meta: [
      { title: "Admin Dashboard — ONE WAVE" },
      {
        name: "description",
        content: "Shop overview: members, resellers, outstanding coins and points, ratings and recent activity.",
      },
      { property: "og:title", content: "Admin Dashboard — ONE WAVE" },
      {
        property: "og:description",
        content: "Shop overview: members, resellers, outstanding coins and points, ratings and recent activity.",
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
  const { account, ecosystem, ecosystemDbId } = useSession("admin");
  const [dash, setDash] = useState<Dash | null>(null);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const shop = useShopStatus(ecosystemDbId);

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

  return (
    <>
      <DevSlot name="dashboard.demo">
      {shop.isDemo ? (
        <Card className="mb-4 border-warning/60 bg-warning/10 shadow-[var(--shadow-card)]">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 px-4">
            <div className="min-w-0">
              <StatusBadge tone="warning">
                <FlaskConical className="mr-1 inline size-3.5" /> Demo shop ·{" "}
                {reviewCountdown(shop.reviewEndsAt)}
              </StatusBadge>
              <p className="mt-1.5 text-sm font-semibold">This shop is not live yet</p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Everything here runs on simulated Demo Coins. Pick a plan and pay it with GCash to
                turn this same shop into a live one — same login, name and settings.
              </p>
            </div>
            <Button asChild>
              <Link to="/admin/go-live">
                <Rocket className="mr-1 size-4" /> Subscribe &amp; Go Live
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}
      </DevSlot>

      {/* Legacy shops are not subscription shops: they keep their own
          arrangement, so no plan countdown, expiry or Go Live prompt is ever
          shown to their admin. `shop_kind` is the only source of truth. */}
      {shop.isNewGeneration && !shop.isDemo ? (
        <DevSlot name="dashboard.subscription">
          <SubscriptionCountdownCard
            planName={ecosystem.subscription?.planName}
            periodEnd={ecosystem.subscription?.currentPeriodEnd}
            graceDays={Number(ecosystem.subscription?.gracePeriodDays ?? 0)}
            state={ecosystem.subscription?.status}
            monthlyPrice={ecosystem.subscription?.priceMonthly}
          />
        </DevSlot>
      ) : null}



      <DevSlot name="dashboard.stats">
      <PageSection
        title={ecosystem.name}
        description="Live figures from your shop — nothing here is shared with other shops."
      >
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatCard
            label="Customers"
            value={loading ? "—" : String(dash?.customer_count ?? 0)}
            icon={Users}
            tone="brand"
            hint={`${dash?.suspended_customer_count ?? 0} suspended`}
          />
          <StatCard
            label="Resellers"
            value={loading ? "—" : String(dash?.reseller_count ?? 0)}
            icon={Users}
            hint={`${dash?.member_count ?? 0} members in total`}
          />
          <StatCard
            label="Subresellers"
            value={loading ? "—" : String(dash?.subreseller_count ?? 0)}
            icon={Users}
            hint="Owned by a parent reseller"
          />

          <StatCard
            label="Coins outstanding"
            value={loading ? "—" : peso(Number(dash?.credits_outstanding ?? 0))}
            icon={Coins}
            tone="positive"
            hint="Held in member wallets"
          />
          <StatCard
            label="Points outstanding"
            value={loading ? "—" : pts(dash?.points_outstanding ?? 0)}
            icon={Coins}
            hint="Redeemable balance"
          />
        </div>
      </PageSection>

      </DevSlot>

      <DevSlot name="dashboard.earnings">
        <AdminEarningsPanel ecosystemId={ecosystemDbId} adminId={account?.id ?? null} />
      </DevSlot>

      <DevSlot name="dashboard.sales">
      <PageSection title="Voucher sales" description="Voucher engine arrives in a later stage.">
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="space-y-2 text-center">
            <Ticket className="mx-auto size-6 text-muted-foreground" />
            <p className="text-sm font-medium">Sales reporting not available yet</p>
            <p className="text-xs text-muted-foreground">
              Voucher dispensing, coin movement and revenue reporting are not implemented, so no
              figures are shown here rather than estimated ones.
            </p>
          </CardContent>
        </Card>
      </PageSection>


      </DevSlot>

      <DevSlot name="dashboard.activity">
      <PageSection
        title="Recent activity"
        description="Audit trail for this shop."
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

      </DevSlot>

      <DevSlot name="dashboard.signup-link">
      <Card className="shadow-[var(--shadow-card)]">
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <Link2 className="mt-0.5 size-5 text-primary" />
            <div>
              <p className="text-sm font-medium">Customer signup link</p>
              <p className="text-xs text-muted-foreground">
                Share /join/{ecosystem.slug} to onboard customers straight into this shop.
              </p>
            </div>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link to="/admin/signup-link">Open link page</Link>
          </Button>
        </CardContent>
      </Card>
      </DevSlot>
    </>
  );
}
