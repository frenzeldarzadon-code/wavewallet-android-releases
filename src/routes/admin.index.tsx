import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Coins, Link2, Ticket, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageSection, StatCard } from "@/components/ui-kit";
import { useSession } from "@/lib/session";
import { supabase } from "@/integrations/supabase/client";
import { AdminEarningsPanel } from "@/components/admin-earnings-panel";
import { peso, shortDateTime } from "@/lib/wavewallet";

export const Route = createFileRoute("/admin/")({
  head: () => ({
    meta: [
      { title: "Admin Dashboard — WaveWallet" },
      {
        name: "description",
        content: "Shop overview: members, resellers, outstanding credits and points, ratings and recent activity.",
      },
      { property: "og:title", content: "Admin Dashboard — WaveWallet" },
      {
        property: "og:description",
        content: "Shop overview: members, resellers, outstanding credits and points, ratings and recent activity.",
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

  return (
    <>


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

      <AdminEarningsPanel ecosystemId={ecosystemDbId} adminId={account?.id ?? null} />


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
    </>
  );
}
