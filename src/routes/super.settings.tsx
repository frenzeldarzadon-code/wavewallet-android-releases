import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageSection } from "@/components/ui-kit";
import { RetentionPolicyCard } from "@/components/retention-policy-card";
import { SocialSettingsCard } from "@/components/social/social-settings-card";
import { supabase } from "@/integrations/supabase/client";
import {
  BILLING_PERIODS,
  fetchPlatformSettings,
  type BillingPeriod,
  type PlatformSettings,
} from "@/lib/subscription";
import { toast } from "sonner";

export const Route = createFileRoute("/super/settings")({
  head: () => ({
    meta: [
      { title: "Platform Settings — WaveWallet Super Admin" },
      { name: "description", content: "Configure subscription price, billing period, grace period, GCash collection details and support channel." },
      { property: "og:title", content: "Platform Settings — WaveWallet Super Admin" },
      { property: "og:description", content: "Configure subscription price, billing period, grace period, GCash collection details and support channel." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SuperSettings,
});

function SuperSettings() {
  const [form, setForm] = useState<PlatformSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void fetchPlatformSettings().then(setForm);
  }, []);

  if (!form) return <p className="text-sm text-muted-foreground">Loading platform settings…</p>;

  const set = <K extends keyof PlatformSettings>(key: K, value: PlatformSettings[K]) =>
    setForm((f) => (f ? { ...f, [key]: value } : f));

  const save = async () => {
    setSaving(true);
    const { data, error } = await supabase.rpc("update_platform_settings", {
      _plan_name: form.plan_name,
      _plan_price: Number(form.plan_price),
      _billing_period: form.billing_period,
      _grace_period_days: Number(form.grace_period_days),
      _currency: form.currency,
      _gcash_number: form.gcash_number,
      _gcash_account_name: form.gcash_account_name,
      _payment_instructions: form.payment_instructions,
      _support_page_name: form.support_page_name,
      _support_page_url: form.support_page_url,
      _support_message: form.support_message,
    });
    setSaving(false);
    if (error) {
      toast.error("Could not save settings", { description: error.message });
      return;
    }
    if (data) setForm(data as PlatformSettings);
    toast.success("Platform settings saved", {
      description: "New pricing applies to future subscription requests only.",
    });
  };

  return (
    <>
      <PageSection
        title="Subscription plan"
        description="Price changes apply to future requests — approved subscriptions keep the amount they were billed."
      >
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="planName">Plan name</Label>
              <Input
                id="planName"
                value={form.plan_name}
                onChange={(e) => set("plan_name", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="planPrice">Price per period (PHP)</Label>
              <Input
                id="planPrice"
                type="number"
                value={String(form.plan_price)}
                onChange={(e) => set("plan_price", Number(e.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="period">Billing period</Label>
              <Select
                value={form.billing_period}
                onValueChange={(v) => set("billing_period", v as BillingPeriod)}
              >
                <SelectTrigger id="period">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BILLING_PERIODS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="grace">Grace period (days)</Label>
              <Input
                id="grace"
                type="number"
                value={String(form.grace_period_days)}
                onChange={(e) => set("grace_period_days", Number(e.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="currency">Currency</Label>
              <Input
                id="currency"
                value={form.currency}
                onChange={(e) => set("currency", e.target.value)}
              />
            </div>
          </CardContent>
        </Card>
      </PageSection>

      <PageSection title="Collection details" description="Shown to operators on their subscription screen.">
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="gcashNo">GCash number</Label>
              <Input
                id="gcashNo"
                value={form.gcash_number}
                onChange={(e) => set("gcash_number", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gcashName">GCash account name</Label>
              <Input
                id="gcashName"
                value={form.gcash_account_name}
                onChange={(e) => set("gcash_account_name", e.target.value)}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="instructions">Payment instructions</Label>
              <Textarea
                id="instructions"
                rows={3}
                value={form.payment_instructions}
                onChange={(e) => set("payment_instructions", e.target.value)}
              />
            </div>
          </CardContent>
        </Card>
      </PageSection>

      <PageSection title="Platform support">
        <Card className="shadow-[var(--shadow-card)]">
          <CardHeader>
            <CardTitle className="text-sm">Facebook support channel</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="fbName">Page name</Label>
              <Input
                id="fbName"
                value={form.support_page_name}
                onChange={(e) => set("support_page_name", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fbUrl">Page URL</Label>
              <Input
                id="fbUrl"
                value={form.support_page_url}
                onChange={(e) => set("support_page_url", e.target.value)}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="fbMsg">Support message</Label>
              <Textarea
                id="fbMsg"
                rows={2}
                value={form.support_message}
                onChange={(e) => set("support_message", e.target.value)}
              />
            </div>
          </CardContent>
        </Card>
      </PageSection>

      <Button disabled={saving} onClick={() => void save()}>
        {saving ? "Saving…" : "Save changes"}
      </Button>

      <SocialSettingsCard />

      <RetentionPolicyCard canRun />
    </>
  );
}

