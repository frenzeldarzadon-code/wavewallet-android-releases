import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageSection, StatusBadge, subscriptionTone } from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { writeSession } from "@/lib/session";
import { peso, shortDate, statusLabel } from "@/lib/wavewallet";
import { toast } from "sonner";

type EcoRow = Database["public"]["Tables"]["ecosystems"]["Row"];
type Invitation = Database["public"]["Tables"]["admin_invitations"]["Row"];

export const Route = createFileRoute("/super/admins")({
  head: () => ({
    meta: [
      { title: "Ecosystems & Admins — WaveWallet Super Admin" },
      { name: "description", content: "Create tenant ecosystems, invite admins and enter Super Admin Mode." },
      { property: "og:title", content: "Ecosystems & Admins — WaveWallet Super Admin" },
      { property: "og:description", content: "Create tenant ecosystems, invite admins and enter Super Admin Mode." },
    ],
  }),
  component: SuperAdmins,
});

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function SuperAdmins() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ecosystems, setEcosystems] = useState<EcoRow[]>([]);
  const [invites, setInvites] = useState<Invitation[]>([]);
  const [form, setForm] = useState({ name: "", description: "", email: "" });

  const load = useCallback(async () => {
    const [{ data: ecos, error: ecoErr }, { data: inv }] = await Promise.all([
      supabase.from("ecosystems").select("*").order("created_at", { ascending: false }),
      supabase.rpc("list_admin_invitations"),
    ]);
    if (ecoErr) toast.error("Could not load ecosystems", { description: ecoErr.message });
    setEcosystems(ecos ?? []);
    setInvites((inv as Invitation[] | null) ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const access = (ecosystemId: string) => {
    writeSession({ accountId: "db", ecosystemId, superAdminMode: true });
    navigate({ to: "/admin" });
  };

  const create = async () => {
    const name = form.name.trim();
    const email = form.email.trim().toLowerCase();
    if (!name || !email) return;
    setSaving(true);
    const { data: eco, error } = await supabase
      .from("ecosystems")
      .insert({
        name,
        slug: slugify(name),
        description: form.description.trim() || null,
        contact_email: email,
      })
      .select("id")
      .single();
    if (error || !eco) {
      setSaving(false);
      toast.error("Could not create ecosystem", { description: error?.message });
      return;
    }
    const { error: inviteErr } = await supabase.rpc("invite_admin", {
      _ecosystem_id: eco.id,
      _email: email,
      _role: "admin",
    });
    setSaving(false);
    if (inviteErr) {
      toast.error("Ecosystem created, invite failed", { description: inviteErr.message });
    } else {
      toast.success("Ecosystem created & admin invited", {
        description: `${email} becomes admin on first signup.`,
      });
    }
    setForm({ name: "", description: "", email: "" });
    setOpen(false);
    await load();
  };

  const revoke = async (id: string) => {
    const { error } = await supabase.rpc("revoke_admin_invitation", { _id: id });
    if (error) {
      toast.error("Could not revoke invitation", { description: error.message });
      return;
    }
    await load();
    toast.success("Invitation revoked");
  };

  return (
    <>
      <PageSection
        title="Admin ecosystems"
        description="One Admin ecosystem = one isolated tenant. Multiple admin users may share an ecosystem."
        action={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="size-4" /> New admin
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Create ecosystem & invite admin</DialogTitle>
                <DialogDescription>
                  The invited email is granted the admin role on the ecosystem when they sign up. Admin
                  accounts can never be created through public signup.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="ecoName">Ecosystem / shop name</Label>
                  <Input
                    id="ecoName"
                    placeholder="e.g. Northview WiFi"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  />
                  {form.name ? (
                    <p className="text-xs text-muted-foreground">Signup link: /join/{slugify(form.name)}</p>
                  ) : null}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ecoDesc">Description</Label>
                  <Textarea
                    id="ecoDesc"
                    rows={2}
                    placeholder="Coverage area, sites served…"
                    value={form.description}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="adminEmail">Admin email</Label>
                  <Input
                    id="adminEmail"
                    type="email"
                    placeholder="admin@shop.com"
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button disabled={saving || !form.name.trim() || !form.email.trim()} onClick={() => void create()}>
                  Create & invite
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      >
        <Card className="overflow-hidden py-0 shadow-[var(--shadow-card)]">
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ecosystem</TableHead>
                    <TableHead className="hidden md:table-cell">Signup link</TableHead>
                    <TableHead className="hidden sm:table-cell">Created</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ecosystems.map((eco) => (
                    <TableRow key={eco.id}>
                      <TableCell>
                        <p className="font-medium">{eco.name}</p>
                        <p className="text-xs text-muted-foreground">{eco.contact_email ?? "—"}</p>
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                        /join/{eco.slug}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                        {shortDate(eco.created_at)}
                      </TableCell>
                      <TableCell className="text-sm">{peso(Number(eco.plan_price))}/mo</TableCell>
                      <TableCell>
                        <StatusBadge tone={subscriptionTone(eco.subscription_state)}>
                          {statusLabel[eco.subscription_state]}
                        </StatusBadge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" onClick={() => access(eco.id)}>
                          Access
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {ecosystems.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-sm text-muted-foreground">
                        No ecosystems yet — create the first tenant.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </PageSection>

      <PageSection
        title="Admin invitations"
        description="Invited emails receive their role automatically the first time they sign up."
      >
        <Card className="overflow-hidden py-0 shadow-[var(--shadow-card)]">
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead className="hidden sm:table-cell">Invited by</TableHead>
                    <TableHead className="hidden md:table-cell">Expires</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invites.map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell className="font-medium">{inv.email}</TableCell>
                      <TableCell className="text-sm capitalize">{inv.role.replace("_", " ")}</TableCell>
                      <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                        {inv.invited_by_name ?? "—"}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                        {shortDate(inv.expires_at)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge
                          tone={
                            inv.status === "accepted" ? "success" : inv.status === "pending" ? "brand" : "danger"
                          }
                        >
                          {inv.status}
                        </StatusBadge>
                      </TableCell>
                      <TableCell className="text-right">
                        {inv.status === "pending" ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            onClick={() => void revoke(inv.id)}
                          >
                            <Trash2 className="size-4" /> Revoke
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                  {invites.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-sm text-muted-foreground">
                        No invitations yet.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </PageSection>
    </>
  );
}
