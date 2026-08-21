import { Link, createFileRoute } from "@tanstack/react-router";
import { Facebook } from "lucide-react";
import { useEffect, useState } from "react";
import { fetchPointsRule, setPointsRule } from "@/lib/rewards";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageSection } from "@/components/ui-kit";
import { RetentionPolicyCard } from "@/components/retention-policy-card";
import { ListenerDevicesCard } from "@/components/super/listener-devices-card";
import { ListenerDeviceScreenButton } from "@/components/money/listener-device-screen-button";
import { CashInNumberCard } from "@/components/money/cash-in-number-card";
import { ShopIdentityCard } from "@/components/shop/shop-identity-card";
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

function AdminSettings() {
  const { ecosystem, ecosystemDbId, reload } = useSession("admin");
  const [form, setForm] = useState({
    name: ecosystem?.name ?? "",
    description: ecosystem?.description ?? "",
    contactName: ecosystem?.contactName ?? "",
    contactPhone: ecosystem?.contactPhone ?? "",
    contactEmail: ecosystem?.contactEmail ?? "",
  });
  // True once the admin edits a field — stops async session reloads from
  // clobbering typing, and stops a stale form from overwriting the database.
  const [dirty, setDirty] = useState(false);
  const edit = (patch: Partial<typeof form>) => {
    setDirty(true);
    setForm((f) => ({ ...f, ...patch }));
  };
  const [saving, setSaving] = useState(false);
  const [rule, setRule] = useState("10");
  const [savingRule, setSavingRule] = useState(false);
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

  // The session loads asynchronously, so the first render has empty fields.
  // Mirror the saved values in whenever they change, unless the admin is
  // mid-edit — that would both lose typing and risk saving stale values.
  useEffect(() => {
    if (!ecosystem || dirty) return;
    setForm({
      name: ecosystem.name ?? "",
      description: ecosystem.description ?? "",
      contactName: ecosystem.contactName ?? "",
      contactPhone: ecosystem.contactPhone ?? "",
      contactEmail: ecosystem.contactEmail ?? "",
    });
  }, [
    dirty,
    ecosystem,
    ecosystem?.name,
    ecosystem?.description,
    ecosystem?.contactName,
    ecosystem?.contactPhone,
    ecosystem?.contactEmail,
  ]);

  useEffect(() => {
    if (!ecosystemDbId) return;
    void fetchPointsRule(ecosystemDbId).then((v) => setRule(String(v)));
  }, [ecosystemDbId]);

  // Warn before losing unsaved shop-identity/contact edits.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  if (!ecosystem) return null;

  // Live preview of the link this admin owns and edits below.
  const rawFacebook = (ecosystem.facebookPageUrl ?? "").trim();
  const facebookUrl = isFacebookUrl(rawFacebook) ? rawFacebook : "";


  const save = async () => {
    if (!ecosystemDbId) {
      toast.error("Your shop is still loading — try again in a moment.");
      return;
    }
    if (!form.name.trim()) {
      toast.error("Your shop needs a name.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.rpc("update_ecosystem", {
      _ecosystem_id: ecosystemDbId,
      _name: form.name.trim(),
      _description: form.description.trim(),
      _contact_name: form.contactName.trim(),
      _contact_email: form.contactEmail.trim(),
      _contact_phone: form.contactPhone.trim(),
    });
    setSaving(false);
    if (error) {
      toast.error("Could not save settings", { description: error.message });
      return;
    }
    setDirty(false);
    toast.success("Shop settings saved.", {
      description: "Shop name, description and contact details are stored in the database.",
    });
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
                onChange={(e) => edit({ name: e.target.value })}
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
                onChange={(e) => edit({ description: e.target.value })}
              />
            </div>
          </CardContent>
        </Card>
      </PageSection>

      <PageSection
        title="Shop ID, sign-up link & address"
        description="New members join with your 7-digit Shop ID. The optional shop address decides where your shop appears in municipality discovery."
      >
        <ShopIdentityCard ecosystemId={ecosystemDbId} />
      </PageSection>

      <PageSection title="Contact information">
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="cname">Contact person</Label>
              <Input
                id="cname"
                value={form.contactName}
                onChange={(e) => edit({ contactName: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cphone">Mobile number</Label>
              <Input
                id="cphone"
                value={form.contactPhone}
                onChange={(e) => edit({ contactPhone: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cemail">Email</Label>
              <Input
                id="cemail"
                value={form.contactEmail}
                onChange={(e) => edit({ contactEmail: e.target.value })}
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
                placeholder="Name customers should contact"
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
        description="Each reseller and subreseller has ONE Discount, set on that member only. It is both their share of a purchase and their voucher shop discount — the shop keeps the remainder."
      >
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              A member's Discount is their percentage of the coins they supplied to a purchase
              and, automatically, the discount they pay when buying vouchers. A subreseller's
              Discount comes out of their parent reseller's Discount, and you receive everything
              that is left. Changes apply to future purchases only — history never changes.
            </p>
            <Button size="sm" variant="outline" asChild>
              <Link to="/admin/resellers">Set individual member discounts</Link>
            </Button>
          </CardContent>
        </Card>
      </PageSection>

      <PageSection title="Points rule" description="Points are earned on coin-funded voucher purchases only — never on coin loads or transfers.">

        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rate">Coins required per 1 point</Label>
              <Input
                id="rate"
                type="number"
                value={rule}
                onChange={(e) => setRule(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">
                {Number(rule) > 0
                  ? `${Number(rule)} Coins = 1 Point`
                  : "Enter how many Coins a member must spend to earn 1 point."}
              </p>
            </div>
            <div className="flex items-end gap-2">
              <Button
                variant="outline"
                disabled={savingRule}
                onClick={async () => {
                  if (!ecosystemDbId) return;
                  const v = Number(rule);
                  if (!v || v <= 0) {
                    toast.error("Enter a coin amount greater than zero");
                    return;
                  }
                  setSavingRule(true);
                  try {
                    const saved = await setPointsRule(ecosystemDbId, v);
                    // Re-read what the database actually stored, so the field
                    // never shows a value that was not persisted.
                    const fresh = await fetchPointsRule(ecosystemDbId);
                    setRule(String(fresh || saved || v));
                    toast.success(`From now on, ${fresh || v} Coins = 1 Point. Past purchases are unchanged.`);
                  } catch (e) {
                    toast.error("Could not save the points rule", {
                      description: (e as Error).message,
                    });
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
        <Button onClick={save} disabled={saving || !ecosystemDbId}>
          {saving ? "Saving…" : dirty ? "Save changes*" : "Save changes"}
        </Button>
        {dirty ? (
          <p className="text-xs text-destructive">You have unsaved changes on this page.</p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Shop name, description and contact details are stored in the database and audit-logged.
          Your Facebook support page is stored per shop and audit-logged on every change.
        </p>
      </div>

      <CashInNumberCard ecosystemId={ecosystemDbId ?? null} />
      {ecosystemDbId ? (
        <>
          <ListenerDeviceScreenButton />
          <ListenerDevicesCard ecosystemId={ecosystemDbId} ecosystemName={ecosystem.name} />
        </>
      ) : null}
      <RetentionPolicyCard />
    </>
  );
}
