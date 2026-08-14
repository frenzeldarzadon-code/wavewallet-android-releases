import { createFileRoute } from "@tanstack/react-router";
import { Facebook } from "lucide-react";
import { useEffect, useState } from "react";
import { fetchPointsRule, setPointsRule } from "@/lib/rewards";
import { fetchEcosystemRates, setEcosystemRates } from "@/lib/wallet";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageSection } from "@/components/ui-kit";
import { RetentionPolicyCard } from "@/components/retention-policy-card";
import { useSession } from "@/lib/session";
import {
  facebookLabel,
  isFacebookUrl,
  setEcosystemFacebook,
  validateFacebookUrl,
} from "@/lib/facebook";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/settings")({
  head: () => ({
    meta: [
      { title: "Shop Settings — WaveWallet Admin" },
      { name: "description", content: "Name your shop, set contact details, Facebook support channel and points earning rules." },
      { property: "og:title", content: "Shop Settings — WaveWallet Admin" },
      { property: "og:description", content: "Name your shop, set contact details, Facebook support channel and points earning rules." },
    ],
  }),
  component: AdminSettings,
});

/** Percentage fields are held as strings so the inputs stay controlled. */
type RateForm = {
  resellerSale: string;
  subresellerSale: string;
  upline: string;
  resellerDiscount: string;
  subresellerDiscount: string;
};

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
  const [rates, setRates] = useState<RateForm>({
    resellerSale: "0",
    subresellerSale: "0",
    upline: "0",
    resellerDiscount: "0",
    subresellerDiscount: "0",
  });
  const [savingRates, setSavingRates] = useState(false);
  // Own-shop Facebook support page — admins may edit their own ecosystem only.
  const [fb, setFb] = useState({
    url: ecosystem?.facebookPageUrl ?? "",
    name: ecosystem?.facebookPageName ?? "",
  });
  const [savingFb, setSavingFb] = useState(false);
  const fbProblem = validateFacebookUrl(fb.url);

  const saveFacebook = async () => {
    if (!ecosystemDbId) return;
    setSavingFb(true);
    try {
      await setEcosystemFacebook(ecosystemDbId, fb.url, fb.name);
      toast.success(fb.url.trim() ? "Facebook page saved." : "Facebook link removed.");
      await reload?.();
    } catch (e) {
      toast.error("Could not save Facebook page", { description: (e as Error).message });
    } finally {
      setSavingFb(false);
    }
  };
  // Session data arrives asynchronously; mirror it into the editable fields once.
  useEffect(() => {
    setFb({
      url: ecosystem?.facebookPageUrl ?? "",
      name: ecosystem?.facebookPageName ?? "",
    });
  }, [ecosystem?.facebookPageUrl, ecosystem?.facebookPageName]);

  useEffect(() => {
    if (!ecosystemDbId) return;
    void fetchPointsRule(ecosystemDbId).then((v) => setRule(String(v)));
    void fetchEcosystemRates(ecosystemDbId).then((r) =>
      setRates({
        resellerSale: String(r.resellerSale),
        subresellerSale: String(r.subresellerSale),
        upline: String(r.upline),
        resellerDiscount: String(r.resellerDiscount),
        subresellerDiscount: String(r.subresellerDiscount),
      }),
    );
  }, [ecosystemDbId]);

  const saveRates = async () => {
    if (!ecosystemDbId) return;
    const parsed = {
      resellerSale: Number(rates.resellerSale),
      subresellerSale: Number(rates.subresellerSale),
      upline: Number(rates.upline),
      resellerDiscount: Number(rates.resellerDiscount),
      subresellerDiscount: Number(rates.subresellerDiscount),
    };
    if (Object.values(parsed).some((v) => Number.isNaN(v) || v < 0 || v > 100)) {
      toast.error("Every percentage must be between 0% and 100%.");
      return;
    }
    setSavingRates(true);
    try {
      await setEcosystemRates(ecosystemDbId, parsed);
      toast.success("Rates and discounts saved — future transactions only.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSavingRates(false);
    }
  };

  if (!ecosystem) return null;

  // Live preview of the link this admin owns and edits below.
  const rawFacebook = (ecosystem.facebookPageUrl ?? "").trim();
  const facebookUrl = isFacebookUrl(rawFacebook) ? rawFacebook : "";


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
    toast.success("Shop settings saved.");
    await reload?.();
  };

  return (
    <>
      <PageSection title="Shop identity" description="Your name appears throughout the app for your resellers and customers.">
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="name">Shop / shop name</Label>
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

      <PageSection
        title="Facebook support"
        description="Your own shop's support page. Your resellers and subresellers see this link on their dashboard. Leave it empty to remove the link."
      >
        <Card className="shadow-[var(--shadow-card)]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Facebook className="size-4 text-primary" /> Support page
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="fbName">Page name (optional)</Label>
              <Input
                id="fbName"
                value={fb.name}
                placeholder="Sagada Wave Support"
                onChange={(e) => setFb({ ...fb, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fbUrl">Facebook page URL</Label>
              <Input
                id="fbUrl"
                value={fb.url}
                placeholder="https://facebook.com/yourpage"
                onChange={(e) => setFb({ ...fb, url: e.target.value })}
              />
              {fbProblem ? <p className="text-[11px] text-destructive">{fbProblem}</p> : null}
            </div>
            <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
              <Button
                size="sm"
                variant="outline"
                disabled={savingFb || Boolean(fbProblem)}
                onClick={() => void saveFacebook()}
              >
                {savingFb ? "Saving…" : "Save Facebook page"}
              </Button>
              {facebookUrl ? (
                <a
                  href={facebookUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="break-all text-xs text-primary underline"
                >
                  {facebookLabel(facebookUrl, ecosystem.facebookPageName)}
                </a>
              ) : (
                <span className="text-xs text-muted-foreground">No link configured yet</span>
              )}
            </div>
          </CardContent>
        </Card>
      </PageSection>


      <PageSection
        title="Voucher sale earnings"
        description="Earnings happen when a voucher is bought — never when credits are transferred. Sending ₱1,000 always delivers exactly ₱1,000."
      >
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="saleReseller">Reseller sale commission (%)</Label>
              <Input
                id="saleReseller"
                type="number"
                min={0}
                max={100}
                value={rates.resellerSale}
                onChange={(e) => setRates({ ...rates, resellerSale: e.target.value })}
              />
              <p className="text-[11px] text-muted-foreground">
                Paid to the reseller whose credits funded the customer's purchase.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="saleSub">Subreseller sale cashback (%)</Label>
              <Input
                id="saleSub"
                type="number"
                min={0}
                max={100}
                value={rates.subresellerSale}
                onChange={(e) => setRates({ ...rates, subresellerSale: e.target.value })}
              />
              <p className="text-[11px] text-muted-foreground">
                Paid to the subreseller whose credits funded the customer's purchase.
              </p>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="upline">Parent reseller (upline) commission (%)</Label>
              <Input
                id="upline"
                type="number"
                min={0}
                max={100}
                value={rates.upline}
                onChange={(e) => setRates({ ...rates, upline: e.target.value })}
              />
              <p className="text-[11px] text-muted-foreground">
                Paid to a subreseller's parent reseller on that subreseller's sales and on
                vouchers the subreseller buys for their own use. A subreseller never earns on
                their own purchase; a reseller has no upline.
              </p>
            </div>
          </CardContent>
        </Card>
      </PageSection>

      <PageSection
        title="Wholesale voucher discounts"
        description="A discount is a lower purchase price, not an earning. Discount and sale commission are recorded separately on every sale."
      >
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="resDisc">Reseller voucher discount (%)</Label>
              <Input
                id="resDisc"
                type="number"
                min={0}
                max={100}
                value={rates.resellerDiscount}
                onChange={(e) => setRates({ ...rates, resellerDiscount: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="subDisc">Subreseller voucher discount (%)</Label>
              <Input
                id="subDisc"
                type="number"
                min={0}
                max={100}
                value={rates.subresellerDiscount}
                onChange={(e) => setRates({ ...rates, subresellerDiscount: e.target.value })}
              />
            </div>
            <div className="flex items-end gap-2 sm:col-span-2">
              <Button variant="outline" disabled={savingRates} onClick={saveRates}>
                {savingRates ? "Saving…" : "Save rates & discounts"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground sm:col-span-2">
              A member with a personal rate set in Customers overrides the shop default. Every
              sale stores the list price, discount percent, discount amount, amount paid and the
              commission rates used, so changing anything here affects future transactions only.
              Historical loading commissions from the old model stay in history exactly as
              recorded and no longer apply to transfers.
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
          Your Facebook support page is stored per shop and audit-logged on every change.
        </p>
      </div>

      <RetentionPolicyCard />
    </>
  );
}
