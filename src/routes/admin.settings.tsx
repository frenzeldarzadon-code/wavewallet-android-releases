import { createFileRoute } from "@tanstack/react-router";
import { Facebook } from "lucide-react";
import { useEffect, useState } from "react";
import { fetchPointsRule, setPointsRule } from "@/lib/rewards";
import { fetchEcosystemCommission, setEcosystemCommission } from "@/lib/wallet";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageSection } from "@/components/ui-kit";
import { RetentionPolicyCard } from "@/components/retention-policy-card";
import { useSession } from "@/lib/session";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/settings")({
  head: () => ({
    meta: [
      { title: "Ecosystem Settings — WaveWallet Admin" },
      { name: "description", content: "Name your shop, set contact details, Facebook support channel and points earning rules." },
      { property: "og:title", content: "Ecosystem Settings — WaveWallet Admin" },
      { property: "og:description", content: "Name your shop, set contact details, Facebook support channel and points earning rules." },
    ],
  }),
  component: AdminSettings,
});

function AdminSettings() {
  const { ecosystem, ecosystemDbId, reload } = useSession("admin");
  const [form, setForm] = useState({
    name: ecosystem?.name ?? "",
    description: ecosystem?.description ?? "",
    contactPhone: ecosystem?.contactPhone ?? "",
    contactEmail: ecosystem?.contactEmail ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [rule, setRule] = useState("10");
  const [savingRule, setSavingRule] = useState(false);
  const [commission, setCommission] = useState("0");
  const [savingCommission, setSavingCommission] = useState(false);
  useEffect(() => {
    if (!ecosystemDbId) return;
    void fetchPointsRule(ecosystemDbId).then((v) => setRule(String(v)));
    void fetchEcosystemCommission(ecosystemDbId).then((v) => setCommission(String(v)));
  }, [ecosystemDbId]);
  if (!ecosystem) return null;

  const save = async () => {
    if (!ecosystemDbId) return;
    if (!form.name.trim()) {
      toast.error("Your shop needs a name.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.rpc("update_ecosystem", {
      _ecosystem_id: ecosystemDbId,
      _name: form.name.trim(),
      _description: form.description.trim(),
      _contact_email: form.contactEmail.trim(),
      _contact_phone: form.contactPhone.trim(),
    });
    setSaving(false);
    if (error) {
      toast.error("Could not save settings", { description: error.message });
      return;
    }
    toast.success("Ecosystem settings saved.");
    await reload?.();
  };

  return (
    <>
      <PageSection title="Shop identity" description="Your name appears throughout the app for your resellers and customers.">
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="name">Ecosystem / shop name</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="slug">URL slug</Label>
              <Input id="slug" readOnly value={ecosystem.slug} className="font-mono text-xs" />
              <p className="text-[11px] text-muted-foreground">
                The slug drives /join/{ecosystem.slug}. Ask the platform owner to change it.
              </p>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="desc">Description</Label>
              <Textarea
                id="desc"
                rows={2}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
          </CardContent>
        </Card>
      </PageSection>

      <PageSection title="Contact information">
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="cname">Contact person</Label>
              <Input id="cname" defaultValue={ecosystem.contactName} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cphone">Mobile number</Label>
              <Input
                id="cphone"
                value={form.contactPhone}
                onChange={(e) => setForm({ ...form, contactPhone: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cemail">Email</Label>
              <Input
                id="cemail"
                value={form.contactEmail}
                onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
              />
            </div>
          </CardContent>
        </Card>
      </PageSection>

      <PageSection title="Facebook support" description="Shown in help areas for your customers and resellers.">
        <Card className="shadow-[var(--shadow-card)]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Facebook className="size-4 text-primary" /> Support page
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="fbname">Page name</Label>
              <Input id="fbname" defaultValue={ecosystem.facebookPageName} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fburl">Page URL</Label>
              <Input id="fburl" defaultValue={ecosystem.facebookPageUrl} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="fbmsg">Support message</Label>
              <Textarea id="fbmsg" rows={2} defaultValue={ecosystem.facebookSupportMessage} />
            </div>
          </CardContent>
        </Card>
      </PageSection>

      <PageSection
        title="Credit-loading commission"
        description="Bonus credits your resellers receive whenever you or the platform owner release credits to them. Resellers only — subresellers never earn this."
      >
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="commission">Default commission (%)</Label>
              <Input
                id="commission"
                type="number"
                min={0}
                max={100}
                value={commission}
                onChange={(e) => setCommission(e.target.value)}
              />
            </div>
            <div className="flex items-end gap-2">
              <Button
                variant="outline"
                disabled={savingCommission}
                onClick={async () => {
                  if (!ecosystemDbId) return;
                  const v = Number(commission);
                  if (Number.isNaN(v) || v < 0 || v > 100) {
                    toast.error("Commission must be between 0% and 100%.");
                    return;
                  }
                  setSavingCommission(true);
                  try {
                    await setEcosystemCommission(ecosystemDbId, v);
                    toast.success(
                      `Default reseller commission set to ${v}% — future credit releases only.`,
                    );
                  } catch (e) {
                    toast.error((e as Error).message);
                  } finally {
                    setSavingCommission(false);
                  }
                }}
              >
                {savingCommission ? "Saving…" : "Save commission"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground sm:col-span-2">
              Release ₱1,000 to a reseller on {Number(commission) || 0}% and they receive{" "}
              ₱{(1000 * (1 + (Number(commission) || 0) / 100)).toLocaleString()} while your wallet is
              debited ₱1,000 only. A reseller with a personal rate set in Customers overrides this
              default. Past transactions keep the rate they were made with.
            </p>
          </CardContent>
        </Card>
      </PageSection>

      <PageSection title="Points rule" description="Points are earned on credit-funded voucher purchases only — never on credit loads or transfers.">

        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rate">Qualifying spend per 1 point (PHP)</Label>
              <Input
                id="rate"
                type="number"
                value={rule}
                onChange={(e) => setRule(e.target.value)}
              />
            </div>
            <div className="flex items-end gap-2">
              <Button
                variant="outline"
                disabled={savingRule}
                onClick={async () => {
                  if (!ecosystemDbId) return;
                  const v = Number(rule);
                  if (!v || v <= 0) {
                    toast.error("Enter a spend amount greater than zero");
                    return;
                  }
                  setSavingRule(true);
                  try {
                    await setPointsRule(ecosystemDbId, v);
                    toast.success(`From now on, every ₱${v} of qualifying spend earns 1 point. Past purchases are unchanged.`);
                  } catch (e) {
                    toast.error((e as Error).message);
                  } finally {
                    setSavingRule(false);
                  }
                }}
              >
                {savingRule ? "Saving…" : "Save points rule"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground sm:col-span-2">
              Changing this ratio affects <span className="font-medium text-foreground">future qualifying purchases only</span>.
              Points already earned keep the ratio that was active at the time of the purchase and are never recalculated.
            </p>
          </CardContent>
        </Card>
      </PageSection>


      <div className="space-y-2">
        <Button onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
        <p className="text-xs text-muted-foreground">
          Shop name, description and contact details are stored in the database and audit-logged.
          Facebook support details are presentation placeholders.
        </p>
      </div>

      <RetentionPolicyCard />
    </>
  );
}
