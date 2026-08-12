import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageSection } from "@/components/ui-kit";
import { platformSettings } from "@/lib/wavewallet";
import { toast } from "sonner";

export const Route = createFileRoute("/super/settings")({
  head: () => ({
    meta: [
      { title: "Platform Settings — WaveWallet Super Admin" },
      { name: "description", content: "Configure plan pricing, grace period, GCash collection details and platform support channel." },
      { property: "og:title", content: "Platform Settings — WaveWallet Super Admin" },
      { property: "og:description", content: "Configure plan pricing, grace period, GCash collection details and platform support channel." },
    ],
  }),
  component: SuperSettings,
});

function SuperSettings() {
  return (
    <>
      <PageSection title="Subscription plan" description="Applies to new tenants; per-tenant overrides are allowed.">
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="planName">Plan name</Label>
              <Input id="planName" defaultValue={platformSettings.defaultPlanName} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="planPrice">Monthly price (PHP)</Label>
              <Input id="planPrice" type="number" defaultValue={platformSettings.defaultPlanPrice} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="grace">Grace period (days)</Label>
              <Input id="grace" type="number" defaultValue={platformSettings.defaultGraceDays} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="currency">Currency</Label>
              <Input id="currency" defaultValue={platformSettings.currency} />
            </div>
          </CardContent>
        </Card>
      </PageSection>

      <PageSection title="Collection details" description="Shown to admins on their subscription screen.">
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="gcashNo">GCash number</Label>
              <Input id="gcashNo" defaultValue={platformSettings.gcashNumber} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gcashName">GCash account name</Label>
              <Input id="gcashName" defaultValue={platformSettings.gcashAccountName} />
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
              <Input id="fbName" defaultValue={platformSettings.supportPageName} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fbUrl">Page URL</Label>
              <Input id="fbUrl" defaultValue={platformSettings.supportPageUrl} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="fbMsg">Support message</Label>
              <Textarea id="fbMsg" rows={2} defaultValue={platformSettings.supportMessage} />
            </div>
          </CardContent>
        </Card>
      </PageSection>

      <Button onClick={() => toast.success("Platform settings saved (demo)")}>Save changes</Button>
    </>
  );
}
