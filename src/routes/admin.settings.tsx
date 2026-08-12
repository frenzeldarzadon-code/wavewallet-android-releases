import { createFileRoute } from "@tanstack/react-router";
import { Facebook } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageSection } from "@/components/ui-kit";
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

      <PageSection title="Points rule" description="Points are earned on qualifying purchases only — never on credit loads or transfers.">
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rate">Qualifying spend per 1 point (PHP)</Label>
              <Input id="rate" type="number" defaultValue={ecosystem.pointsPerPeso} />
            </div>
            <div className="flex items-end">
              <p className="text-xs text-muted-foreground">
                Current rule: every ₱{ecosystem.pointsPerPeso} of qualifying voucher spend earns 1
                point.
              </p>
            </div>
          </CardContent>
        </Card>
      </PageSection>

      <div className="space-y-2">
        <Button onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
        <p className="text-xs text-muted-foreground">
          Shop name, description and contact details are stored in the database and audit-logged.
          Facebook support details and the points rule are presentation placeholders until the
          rewards engine ships.
        </p>
      </div>
    </>
  );
}
