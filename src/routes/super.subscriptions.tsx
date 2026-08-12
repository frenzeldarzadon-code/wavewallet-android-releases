import { createFileRoute } from "@tanstack/react-router";
import { Check, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageSection, StatCard, StatusBadge, subscriptionTone } from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { peso, shortDate, statusLabel } from "@/lib/wavewallet";
import { toast } from "sonner";

type EcoRow = Database["public"]["Tables"]["ecosystems"]["Row"];
type State = Database["public"]["Enums"]["subscription_state"];

export const Route = createFileRoute("/super/subscriptions")({
  head: () => ({
    meta: [
      { title: "Subscriptions & Revenue — WaveWallet Super Admin" },
      { name: "description", content: "Approve tenant subscription payments and track platform subscription revenue." },
      { property: "og:title", content: "Subscriptions & Revenue — WaveWallet Super Admin" },
      { property: "og:description", content: "Approve tenant subscription payments and track platform subscription revenue." },
    ],
  }),
  component: SuperSubscriptions,
});

/** One month from today, used as the new period end when a payment is approved. */
function nextPeriodEnd() {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return d.toISOString();
}

function SuperSubscriptions() {
  const [rows, setRows] = useState<EcoRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("ecosystems")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      toast.error("Could not load tenants", { description: error.message });
      return;
    }
    setRows(data ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const review = async (eco: EcoRow, state: State) => {
    setBusy(eco.id);
    const { error } = await supabase.rpc("review_subscription", {
      _ecosystem_id: eco.id,
      _state: state,
      ...(state === "active" ? { _period_end: nextPeriodEnd() } : {}),
    });
    setBusy(null);
    if (error) {
      toast.error("Review failed", { description: error.message });
      return;
    }
    await load();
    if (state === "active") toast.success(`Approved ${eco.name}`);
    else toast.error(`Rejected ${eco.name}`);
  };

  const pending = rows.filter(
    (e) => e.subscription_state === "awaiting_approval" || e.subscription_state === "pending",
  );
  const active = rows.filter((e) => e.subscription_state === "active");
  const mrr = active.reduce((s, e) => s + Number(e.plan_price), 0);

  return (
    <>
      <PageSection>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Monthly recurring" value={peso(mrr)} tone="positive" hint="Active tenants" />
          <StatCard label="Awaiting approval" value={String(pending.length)} tone="negative" />
          <StatCard label="Active tenants" value={String(active.length)} tone="brand" />
          <StatCard label="Total tenants" value={String(rows.length)} />
        </div>
      </PageSection>

      <PageSection title="Payment submissions" description="Approve or reject GCash reference submissions.">
        <div className="grid gap-3 md:grid-cols-2">
          {pending.length === 0 ? (
            <p className="text-sm text-muted-foreground">No submissions awaiting review.</p>
          ) : null}
          {pending.map((eco) => (
            <Card key={eco.id} className="shadow-[var(--shadow-card)]">
              <CardContent className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{eco.name}</p>
                    <p className="text-xs text-muted-foreground">{eco.contact_email ?? "—"}</p>
                  </div>
                  <StatusBadge tone={subscriptionTone(eco.subscription_state)}>
                    {statusLabel[eco.subscription_state]}
                  </StatusBadge>
                </div>
                <dl className="grid grid-cols-2 gap-y-2 text-xs">
                  <div>
                    <dt className="text-muted-foreground">Amount</dt>
                    <dd className="font-medium">{peso(Number(eco.plan_price))}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Reference</dt>
                    <dd className="font-medium">{eco.payment_reference ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Submitted</dt>
                    <dd className="font-medium">{eco.submitted_at ? shortDate(eco.submitted_at) : "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Grace period</dt>
                    <dd className="font-medium">{eco.grace_period_days} days</dd>
                  </div>
                </dl>
                <div className="flex gap-2">
                  <Button size="sm" className="flex-1" disabled={busy === eco.id} onClick={() => void review(eco, "active")}>
                    <Check className="size-4" /> Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 text-destructive"
                    disabled={busy === eco.id}
                    onClick={() => void review(eco, "rejected")}
                  >
                    <X className="size-4" /> Reject
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </PageSection>

      <PageSection title="Subscription history" description="Tenant data is retained on expiry — never deleted.">
        <Card className="overflow-hidden py-0 shadow-[var(--shadow-card)]">
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ecosystem</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead className="hidden sm:table-cell">Reference</TableHead>
                    <TableHead className="hidden md:table-cell">Period end</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((eco) => (
                    <TableRow key={eco.id}>
                      <TableCell className="font-medium">{eco.name}</TableCell>
                      <TableCell className="text-sm">
                        {eco.plan_name} · {peso(Number(eco.plan_price))}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                        {eco.payment_reference ?? "—"}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                        {eco.current_period_end ? shortDate(eco.current_period_end) : "—"}
                      </TableCell>
                      <TableCell>
                        <StatusBadge tone={subscriptionTone(eco.subscription_state)}>
                          {statusLabel[eco.subscription_state]}
                        </StatusBadge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </PageSection>
    </>
  );
}
