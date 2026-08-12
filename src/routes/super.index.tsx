import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Building2, Coins, CreditCard, TrendingUp, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageSection, StatCard, StatusBadge, subscriptionTone } from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";
import { writeSession } from "@/lib/session";
import {
  ecosystemCounts,
  platformMrr,
  totalAccounts,
  type EcosystemOverviewRow,
} from "@/lib/platform-overview";
import { peso, shortDateTime, statusLabel } from "@/lib/wavewallet";
import { MemberPicker } from "@/components/member-picker";
import { EditMemberDialog, type EditableMember } from "@/components/edit-member-dialog";

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

interface AuditRow {
  id: string;
  action: string;
  target: string;
  actor_name: string;
  created_at: string;
}

interface Settings {
  plan_name: string;
  plan_price: number;
  grace_period_days: number;
}

function SuperOverview() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<EcosystemOverviewRow[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [editingMember, setEditingMember] = useState<EditableMember | null>(null);

  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void (async () => {
      const [{ data: overview, error }, { data: a }, { data: s }] = await Promise.all([
        supabase.rpc("platform_overview"),
        supabase
          .from("audit_logs")
          .select("id, action, target, actor_name, created_at")
          .order("created_at", { ascending: false })
          .limit(6),
        supabase.from("platform_settings").select("plan_name, plan_price, grace_period_days").maybeSingle(),
      ]);
      if (!active) return;
      if (error) toast.error("Could not load ecosystems", { description: error.message });
      setRows((overview as EcosystemOverviewRow[] | null) ?? []);
      setAudit((a as AuditRow[] | null) ?? []);
      setSettings((s as Settings | null) ?? null);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  const live = useMemo(() => rows.filter((r) => !r.archived_at), [rows]);
  const activeSubs = live.filter((e) => e.subscription_state === "active");
  const mrr = platformMrr(rows);
  const accounts = totalAccounts(live);

  const accessEcosystem = (ecosystemId: string) => {
    writeSession({ accountId: "db", superAdminMode: true, ecosystemId });
    navigate({ to: "/admin" });
  };

  const dash = (v: string) => (loading ? "—" : v);

  return (
    <>
      <PageSection>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Ecosystems"
            value={dash(String(live.length))}
            icon={Building2}
            tone="brand"
            hint={`${activeSubs.length} active`}
          />
          <StatCard
            label="Platform MRR"
            value={dash(peso(mrr))}
            icon={TrendingUp}
            tone="positive"
            hint="Active subscriptions only"
          />
          <StatCard
            label="Accounts"
            value={dash(String(accounts))}
            icon={Users}
            hint="Admins, resellers, subresellers, customers"
          />
          <StatCard
            label="Archived shops"
            value={dash(String(rows.length - live.length))}
            icon={Coins}
            hint="History retained"
          />
        </div>
      </PageSection>

      <PageSection title="Ecosystems" description="Each Admin owns exactly one isolated tenant.">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading live counters…</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {live.map((eco) => {
              const c = ecosystemCounts(eco);
              return (
                <Card key={eco.id} className="shadow-[var(--shadow-card)]">
                  <CardHeader className="gap-1">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base">{eco.name}</CardTitle>
                      <StatusBadge tone={subscriptionTone(eco.subscription_state)}>
                        {statusLabel[eco.subscription_state] ?? eco.subscription_state}
                      </StatusBadge>
                    </div>
                    <p className="text-xs text-muted-foreground">{eco.description ?? "—"}</p>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <dl className="grid grid-cols-2 gap-y-2 text-xs">
                      <div>
                        <dt className="text-muted-foreground">Admins</dt>
                        <dd className="font-medium">{c.admins}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Plan</dt>
                        <dd className="font-medium">
                          {eco.plan_name} · {peso(Number(eco.plan_price))}/mo
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Resellers</dt>
                        <dd className="font-medium">{c.resellers}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Subresellers</dt>
                        <dd className="font-medium">{c.subresellers}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Customers</dt>
                        <dd className="font-medium">
                          {c.customers}
                          {c.suspendedCustomers > 0 ? (
                            <span className="text-muted-foreground">
                              {" "}
                              ({c.activeCustomers} active · {c.suspendedCustomers} suspended)
                            </span>
                          ) : null}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Members</dt>
                        <dd className="font-medium">{c.members}</dd>
                      </div>
                    </dl>
                    <Button size="sm" className="w-full" onClick={() => accessEcosystem(eco.id)}>
                      Access ecosystem
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
            {live.length === 0 ? (
              <p className="text-sm text-muted-foreground">No ecosystems yet.</p>
            ) : null}
          </div>
        )}
      </PageSection>

      <PageSection
        title="Recent platform activity"
        description="Super Admin access and platform changes are audited."
      >
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="divide-y divide-border px-0 py-0">
            {audit.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                No recorded activity yet.
              </p>
            ) : (
              audit.map((e) => (
                <div key={e.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{e.action}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {e.actor_name}
                      {e.target ? ` · ${e.target}` : ""}
                    </p>
                  </div>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {shortDateTime(e.created_at)}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </PageSection>

      <PageSection
        title="Member lookup"
        description="Search any member across every shop by name, email or phone. Results show the shop they belong to; select one to correct their name, phone or email."
      >
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent>
            <MemberPicker
              showEcosystem
              placeholder="Search all shops by name, email or phone"
              onSelect={(m) => setEditingMember(m)}
            />
          </CardContent>
        </Card>
      </PageSection>

      <PageSection title="Plan configuration" description="Prices are configurable, never hard-coded.">
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <div>
              <p className="text-xs text-muted-foreground">Default plan</p>
              <p className="text-sm font-medium">{settings?.plan_name ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Default price</p>
              <p className="text-sm font-medium text-success">
                {settings ? `${peso(Number(settings.plan_price))} / month` : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Grace period</p>
              <p className="text-sm font-medium">
                {settings ? `${settings.grace_period_days} days` : "—"}
              </p>
            </div>
          </CardContent>
        </Card>
      </PageSection>

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <CreditCard className="size-3.5" /> Subscription approvals are handled in the Subscriptions tab.
      </p>
      <EditMemberDialog member={editingMember} onClose={() => setEditingMember(null)} />
    </>
  );
}
