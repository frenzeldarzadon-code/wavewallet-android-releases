import { createFileRoute } from "@tanstack/react-router";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageSection, StatCard, StatusBadge, subscriptionTone } from "@/components/ui-kit";
import { ecosystems, peso, shortDate, statusLabel } from "@/lib/wavewallet";
import { toast } from "sonner";

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

function SuperSubscriptions() {
  const pending = ecosystems.filter(
    (e) => e.subscription.status === "awaiting_approval" || e.subscription.status === "pending",
  );
  const active = ecosystems.filter((e) => e.subscription.status === "active");
  const mrr = active.reduce((s, e) => s + e.subscription.priceMonthly, 0);

  return (
    <>
      <PageSection>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Monthly recurring" value={peso(mrr)} tone="positive" hint="Active tenants" />
          <StatCard label="Awaiting approval" value={String(pending.length)} tone="negative" />
          <StatCard label="Active tenants" value={String(active.length)} tone="brand" />
          <StatCard label="Collected (12 mo)" value={peso(mrr * 9)} hint="Illustrative sample data" />
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
                    <p className="text-xs text-muted-foreground">{eco.contactName}</p>
                  </div>
                  <StatusBadge tone={subscriptionTone(eco.subscription.status)}>
                    {statusLabel[eco.subscription.status]}
                  </StatusBadge>
                </div>
                <dl className="grid grid-cols-2 gap-y-2 text-xs">
                  <div>
                    <dt className="text-muted-foreground">Amount</dt>
                    <dd className="font-medium">{peso(eco.subscription.priceMonthly)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Reference</dt>
                    <dd className="font-medium">{eco.subscription.paymentReference ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Submitted</dt>
                    <dd className="font-medium">
                      {eco.subscription.submittedAt ? shortDate(eco.subscription.submittedAt) : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Grace period</dt>
                    <dd className="font-medium">{eco.subscription.gracePeriodDays} days</dd>
                  </div>
                </dl>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="flex-1"
                    onClick={() => toast.success(`Approved ${eco.name}`)}
                  >
                    <Check className="size-4" /> Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 text-destructive"
                    onClick={() => toast.error(`Rejected ${eco.name}`)}
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
                  {ecosystems.map((eco) => (
                    <TableRow key={eco.id}>
                      <TableCell className="font-medium">{eco.name}</TableCell>
                      <TableCell className="text-sm">
                        {eco.subscription.planName} · {peso(eco.subscription.priceMonthly)}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                        {eco.subscription.paymentReference ?? "—"}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                        {shortDate(eco.subscription.currentPeriodEnd)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge tone={subscriptionTone(eco.subscription.status)}>
                          {statusLabel[eco.subscription.status]}
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
