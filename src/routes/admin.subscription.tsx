import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, Info } from "lucide-react";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageSection, StatusBadge, subscriptionTone } from "@/components/ui-kit";
import { useSession } from "@/lib/session";
import { peso, platformSettings, shortDate, statusLabel } from "@/lib/wavewallet";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/subscription")({
  head: () => ({
    meta: [
      { title: "Subscription — WaveWallet Admin" },
      { name: "description", content: "View your plan, submit a GCash payment reference and track approval status." },
      { property: "og:title", content: "Subscription — WaveWallet Admin" },
      { property: "og:description", content: "View your plan, submit a GCash payment reference and track approval status." },
    ],
  }),
  component: AdminSubscription,
});

function AdminSubscription() {
  const { ecosystem, ecosystemDbId, reload } = useSession("admin");
  const [reference, setReference] = useState("");
  const [saving, setSaving] = useState(false);
  if (!ecosystem) return null;
  const sub = ecosystem.subscription;

  return (
    <>
      <PageSection title="Current plan">
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm text-muted-foreground">{sub.planName}</p>
                <p className="text-2xl font-semibold tracking-tight">
                  {peso(sub.priceMonthly)}
                  <span className="text-sm font-normal text-muted-foreground"> / month</span>
                </p>
              </div>
              <StatusBadge tone={subscriptionTone(sub.status)}>{statusLabel[sub.status]}</StatusBadge>
            </div>
            <dl className="grid grid-cols-2 gap-y-3 border-t border-border pt-4 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs text-muted-foreground">Period ends</dt>
                <dd className="font-medium">{shortDate(sub.currentPeriodEnd)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Grace period</dt>
                <dd className="font-medium">{sub.gracePeriodDays} days</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Last reference</dt>
                <dd className="font-medium">{sub.paymentReference ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Submitted</dt>
                <dd className="font-medium">{sub.submittedAt ? shortDate(sub.submittedAt) : "—"}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </PageSection>

      <PageSection title="Pay via GCash" description="Send the exact amount, then submit your reference number for approval.">
        <div className="grid gap-3 lg:grid-cols-2">
          <Card className="shadow-[var(--shadow-card)]">
            <CardHeader>
              <CardTitle className="text-sm">Payment details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="GCash number" value={platformSettings.gcashNumber} />
              <Row label="Account name" value={platformSettings.gcashAccountName} />
              <Row label="Amount due" value={peso(sub.priceMonthly)} highlight />
              <p className="flex items-start gap-2 rounded-lg bg-brand-soft px-3 py-2 text-xs text-accent-foreground">
                <Info className="mt-0.5 size-3.5 shrink-0" />
                These collection details are configured by the platform and may change.
              </p>
            </CardContent>
          </Card>

          <Card className="shadow-[var(--shadow-card)]">
            <CardHeader>
              <CardTitle className="text-sm">Submit payment</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="ref">GCash reference number</Label>
                <Input
                  id="ref"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="e.g. GC-1234-5678"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="paid">Amount paid</Label>
                <Input id="paid" type="number" defaultValue={sub.priceMonthly} />
              </div>
              <Button
                className="w-full"
                disabled={!reference.trim() || saving || !ecosystemDbId}
                onClick={async () => {
                  if (!ecosystemDbId) return;
                  setSaving(true);
                  const { error } = await supabase.rpc("submit_subscription_payment", {
                    _ecosystem_id: ecosystemDbId,
                    _reference: reference.trim(),
                  });
                  setSaving(false);
                  if (error) {
                    toast.error("Could not submit payment", { description: error.message });
                    return;
                  }
                  setReference("");
                  reload();
                  toast.success("Submitted — awaiting approval", {
                    description: "The platform will review your payment reference.",
                  });
                }}
              >
                <CheckCircle2 className="size-4" /> I have paid — proceed
              </Button>
              <p className="text-[11px] text-muted-foreground">
                Your ecosystem stays read-only until the platform marks the subscription active. No
                tenant data is deleted on expiry.
              </p>
            </CardContent>
          </Card>
        </div>
      </PageSection>
    </>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-border pb-2 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={highlight ? "font-semibold text-success" : "font-medium"}>{value}</span>
    </div>
  );
}
