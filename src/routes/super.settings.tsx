import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageSection } from "@/components/ui-kit";
import { RetentionPolicyCard } from "@/components/retention-policy-card";
import { CreditSupplyCard } from "@/components/super/credit-supply-card";
import { MoneySettingsCard } from "@/components/super/money-settings-card";
import { CashInAutoCard } from "@/components/super/cash-in-auto-card";
import { ListenerDevicesCard } from "@/components/super/listener-devices-card";
import { ListenerDeviceScreenButton } from "@/components/money/listener-device-screen-button";
import { ListenerSourceRulesCard } from "@/components/money/listener-source-rules-card";
import { PlatformListenerCoverageCard } from "@/components/money/platform-cash-in-status";

import { ReceivingAccountsCard } from "@/components/money/receiving-accounts-card";
import { AppReleaseCard } from "@/components/super/app-release-card";
import { SocialSettingsCard } from "@/components/social/social-settings-card";
import { PromotionTiersCard } from "@/components/social/promotion-tiers-card";
import { SOCIAL_ENABLED } from "@/lib/features";
import { supabase } from "@/integrations/supabase/client";
import { fetchPlatformSettings, type PlatformSettings } from "@/lib/subscription";
import { toast } from "sonner";

export const Route = createFileRoute("/super/settings")({
  head: () => ({
    meta: [
      { title: "Platform Settings — ONE WAVE Super Admin" },
      {
        name: "description",
        content:
          "Configure platform receiving accounts, the payment notification listener, support channel, coin supply and platform-wide defaults.",
      },
      { property: "og:title", content: "Platform Settings — ONE WAVE Super Admin" },
      {
        property: "og:description",
        content:
          "Configure platform receiving accounts, the payment notification listener, support channel, coin supply and platform-wide defaults.",
      },
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

  if (!form)
    return (
      <>
        <p className="text-sm text-muted-foreground">Loading platform settings…</p>
        <PageSection
          devSlot="settings.gcash-notification-listener"
          title="Payment notification listener"
          description="Register the paired Android phone and copy its one-time Device ID and pairing secret."
        >
          <ListenerDevicesCard />
        </PageSection>
      </>
    );

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
      description: "Collection and support details updated.",
    });
  };

  return (
    <>
      <PageSection
        devSlot="settings.gcash-notification-listener-2"
        title="Payment notification listener (platform / Universe cash in)"
        description="The platform listener serves Universe wallet cash ins and platform payments. Members pay into the platform collection accounts below (e.g. GCash, MariBank); a paired phone watches ONE receiving number and forwards that app's payment notifications. Accounts without a paired phone stay on manual review."
      >
        <PlatformListenerCoverageCard />
        <ListenerDeviceScreenButton />
        <ListenerDevicesCard />
        <ListenerSourceRulesCard />
      </PageSection>

      <PageSection
        devSlot="settings.platform-subscription-collection"
        title="Legacy subscription GCash fallback"
        description="Older go-live and coin-allocation screens fall back to this single GCash number when no platform collection account is published. It is not what members see for cash in and it is not what the listener watches — those come from Platform collection accounts below."
      >
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="gcashNo">Fallback GCash number</Label>
              <Input
                id="gcashNo"
                value={form.gcash_number}
                onChange={(e) => set("gcash_number", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gcashName">Fallback GCash account name</Label>
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

      <PageSection devSlot="settings.platform-support" title="Platform support">
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

      <MoneySettingsCard />
      <CashInAutoCard />
      <ReceivingAccountsCard
        ecosystemId={null}
        title="Platform collection accounts (Universe cash in & subscriptions)"
        description="Every active account here is offered to members for Universe wallet cash in and to shop admins for platform payments (e.g. GCash and MariBank). Pair a listener phone on an account's number to verify its payments automatically; otherwise its cash ins are reviewed manually. Shop members' own cash in options still come from each shop's listener payment settings."
      />
      <CreditSupplyCard />
      <AppReleaseCard />

      {SOCIAL_ENABLED ? (
        <>
          <SocialSettingsCard />
          <PromotionTiersCard
            ecosystemId={null}
            title="Default promotion types"
            description="Platform-wide promotion levels every shop starts with. Shops may customise or add their own."
          />
        </>
      ) : null}

      <RetentionPolicyCard canRun />
    </>
  );
}
