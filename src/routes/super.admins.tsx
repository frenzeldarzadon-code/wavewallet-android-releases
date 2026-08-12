import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Building2, Copy, Plus, Search, Settings2, Trash2, UserPlus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, PageSection, StatusBadge, subscriptionTone } from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { writeSession } from "@/lib/session";
import { peso, shortDate, statusLabel } from "@/lib/wavewallet";

type Overview = Database["public"]["Functions"]["platform_overview"]["Returns"][number];
type Invitation = Database["public"]["Tables"]["admin_invitations"]["Row"];

export const Route = createFileRoute("/super/admins")({
  head: () => ({
    meta: [
      { title: "Ecosystems & Admins — WaveWallet Super Admin" },
      {
        name: "description",
        content: "Create tenant ecosystems, edit plans, manage signup links and invite operators.",
      },
      { property: "og:title", content: "Ecosystems & Admins — WaveWallet Super Admin" },
      {
        property: "og:description",
        content: "Create tenant ecosystems, edit plans, manage signup links and invite operators.",
      },
    ],
  }),
  component: SuperAdmins;
});

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const origin = () => (typeof window === "undefined" ? "https://wavewallet.app" : window.location.origin);

const emptyForm = {
  name: "",
  slug: "",
  description: "",
  contactEmail: "",
  contactPhone: "",
  planName: "Starter",
  planPrice: "0",
  gracePeriodDays: "5",
  signupEnabled: true,
  adminEmail: "",
};

function SuperAdmins() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<Overview[]>([]);
  const [invites, setInvites] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState<Overview | null>(null);
  const [inviteFor, setInviteFor] = useState<Overview | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: overview, error }, { data: inv }] = await Promise.all([
      supabase.rpc("platform_overview"),
      supabase.rpc("list_admin_invitations"),
    ]);
    if (error) toast.error("Could not load ecosystems", { description: error.message });
    setRows((overview as Overview[] | null) ?? []);
    setInvites((inv as Invitation[] | null) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) =>
      [r.name, r.slug, r.contact_email ?? "", r.plan_name].some((v) =>
        v.toLowerCase().includes(needle),
      ),
    );
  }, [rows, q]);

  const enter = (ecosystemId: string) => {
    writeSession({ accountId: "db", ecosystemId, superAdminMode: true });
    navigate({ to: "/admin" });
  };

  const copy = async (value: string, label = "Link copied") => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(label);
    } catch {
      toast.error("Could not copy — select the text and copy manually.");
    }
  };

  const create = async () => {
    const name = form.name.trim();
    if (!name) {
      toast.error("Give the ecosystem a name.");
      return;
    }
    setSaving(true);
    const { data, error } = await supabase.rpc("create_ecosystem", {
      _name: name,
      _slug: form.slug.trim() || slugify(name),
      _description: form.description.trim(),
      _contact_email: form.contactEmail.trim(),
      _contact_phone: form.contactPhone.trim(),
      _plan_name: form.planName.trim() || "Starter",
      _plan_price: Number(form.planPrice) || 0,
      _grace_period_days: Number(form.gracePeriodDays) || 0,
      _signup_enabled: form.signupEnabled,
    });
    if (error || !data) {
      setSaving(false);
      toast.error("Could not create ecosystem", { description: error?.message });
      return;
    }
    const created = data as unknown as { id: string; slug: string };
    const adminEmail = form.adminEmail.trim().toLowerCase();
    if (adminEmail) {
      const { error: invErr } = await supabase.rpc("invite_admin", {
        _ecosystem_id: created.id,
        _email: adminEmail,
        _role: "admin",
      });
      if (invErr) toast.error("Ecosystem created, invite failed", { description: invErr.message });
      else toast.success(`Ecosystem created — ${adminEmail} invited as admin.`);
    } else {
      toast.success("Ecosystem created");
    }
    if (created.slug !== slugify(form.slug.trim() || name)) {
      toast(`Slug adjusted to /join/${created.slug} to keep it unique.`);
    }
    setSaving(false);
    setForm(emptyForm);
    setCreateOpen(false);
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

  const sendInvite = async () => {
    if (!inviteFor) return;
    const email = inviteEmail.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      toast.error("Enter a valid email address.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.rpc("invite_admin", {
      _ecosystem_id: inviteFor.id,
      _email: email,
      _role: "admin",
    });
    setSaving(false);
    if (error) {
      toast.error("Could not invite", { description: error.message });
      return;
    }
    toast.success(`${email} invited to ${inviteFor.name}`);
    setInviteEmail("");
    setInviteFor(null);
    await load();
  };

  return (
    <>
      <PageSection>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search ecosystems by name, slug, contact or plan"
              className="pl-9"
            />
          </div>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" /> New ecosystem
          </Button>
        </div>
      </PageSection>

      <PageSection
        title="Tenant ecosystems"
        description="One ecosystem = one isolated shop. Counts come straight from the database."
      >
        <Card className="overflow-hidden shadow-[var(--shadow-card)]">
          <CardContent className="px-0">
            {loading ? (
              <p className="px-5 py-8 text-center text-sm text-muted-foreground">Loading ecosystems…</p>
            ) : filtered.length === 0 ? (
              <EmptyState
                title="No ecosystems yet"
                description="Create the first tenant and invite its operator — public signup can never create one."
              />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ecosystem</TableHead>
                      <TableHead>Subscription</TableHead>
                      <TableHead>People</TableHead>
                      <TableHead>Signup</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell>
                          <p className="font-medium">{e.name}</p>
                          <p className="font-mono text-xs text-muted-foreground">/join/{e.slug}</p>
                        </TableCell>
                        <TableCell>
                          <StatusBadge tone={subscriptionTone(e.subscription_state)}>
                            {statusLabel[e.subscription_state] ?? e.subscription_state}
                          </StatusBadge>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {e.plan_name} · {peso(Number(e.plan_price))}/mo
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            {e.current_period_end ? `Ends ${shortDate(e.current_period_end)}` : "No period set"}
                          </p>
                        </TableCell>
                        <TableCell className="text-sm">
                          <p>{e.admin_count} admin{Number(e.admin_count) === 1 ? "" : "s"}</p>
                          <p className="text-xs text-muted-foreground">
                            {e.member_count} members · {e.reseller_count} resellers
                          </p>
                        </TableCell>
                        <TableCell>
                          <StatusBadge tone={e.signup_enabled ? "success" : "danger"}>
                            {e.signup_enabled ? "Open" : "Disabled"}
                          </StatusBadge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex flex-wrap justify-end gap-2">
                            <Button size="sm" variant="outline" onClick={() => setDetail(e)}>
                              <Settings2 className="size-4" /> Manage
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => enter(e.id)}>
                              <Building2 className="size-4" /> Enter
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </PageSection>

      <PageSection
        title="Operator invitations"
        description="Admins exist only by invitation. There is no open operator registration."
      >
        <Card className="overflow-hidden shadow-[var(--shadow-card)]">
          <CardContent className="px-0">
            {invites.length === 0 ? (
              <EmptyState title="No invitations" description="Invite an operator from an ecosystem's Manage panel." />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Email</TableHead>
                      <TableHead>Ecosystem</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invites.map((i) => {
                      const eco = rows.find((r) => r.id === i.ecosystem_id);
                      const expired = i.status === "pending" && new Date(i.expires_at) < new Date();
                      const status = expired ? "expired" : i.status;
                      const link = `${origin()}/invite?email=${encodeURIComponent(i.email)}`;
                      return (
                        <TableRow key={i.id}>
                          <TableCell>
                            <p className="font-medium">{i.email}</p>
                            <p className="text-xs text-muted-foreground">
                              Invited {shortDate(i.created_at)} by {i.invited_by_name ?? "Super admin"}
                            </p>
                          </TableCell>
                          <TableCell className="text-sm">
                            {i.role === "super_admin" ? "Platform-wide" : (eco?.name ?? "—")}
                          </TableCell>
                          <TableCell>
                            <StatusBadge
                              tone={
                                status === "accepted"
                                  ? "success"
                                  : status === "pending"
                                    ? "warning"
                                    : "danger"
                              }
                            >
                              {status}
                            </StatusBadge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex flex-wrap justify-end gap-2">
                              {status === "pending" ? (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => copy(link, "Onboarding link copied")}
                                  >
                                    <Copy className="size-4" /> Link
                                  </Button>
                                  <Button size="sm" variant="ghost" onClick={() => revoke(i.id)}>
                                    <Trash2 className="size-4" /> Revoke
                                  </Button>
                                </>
                              ) : null}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </PageSection>

      <CreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        form={form}
        setForm={setForm}
        saving={saving}
        onSubmit={create}
      />

      {detail ? (
        <ManageDialog
          row={detail}
          onClose={() => setDetail(null)}
          onSaved={load}
          onInvite={(row) => {
            setDetail(null);
            setInviteFor(row);
          }}
          onCopy={copy}
        />
      ) : null}

      <Dialog open={!!inviteFor} onOpenChange={(o) => !o && setInviteFor(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Invite an admin</DialogTitle>
            <DialogDescription>
              {inviteFor?.name} — the invited email is granted the admin role for this ecosystem only,
              on first signup.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="inviteEmail">Email</Label>
            <Input
              id="inviteEmail"
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="operator@example.com"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setInviteFor(null)}>
              Cancel
            </Button>
            <Button onClick={sendInvite} disabled={saving}>
              <UserPlus className="size-4" /> Send invitation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function CreateDialog({
  open,
  onOpenChange,
  form,
  setForm,
  saving,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  form: typeof emptyForm;
  setForm: (f: typeof emptyForm) => void;
  saving: boolean;
  onSubmit: () => void;
}) {
  const preview = slugify(form.slug || form.name);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create ecosystem</DialogTitle>
          <DialogDescription>
            A duplicate slug is resolved automatically by the database, so links never collide.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="cName">Ecosystem / shop name</Label>
            <Input
              id="cName"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Northview WiFi"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="cSlug">Signup slug</Label>
            <Input
              id="cSlug"
              value={form.slug}
              onChange={(e) => setForm({ ...form, slug: e.target.value })}
              placeholder="northview-wifi"
            />
            {preview ? (
              <p className="font-mono text-xs text-muted-foreground">/join/{preview}</p>
            ) : null}
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="cDesc">Description</Label>
            <Textarea
              id="cDesc"
              rows={2}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Coverage area, what customers can buy…"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cEmail">Contact email</Label>
            <Input
              id="cEmail"
              type="email"
              value={form.contactEmail}
              onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cPhone">Contact phone</Label>
            <Input
              id="cPhone"
              value={form.contactPhone}
              onChange={(e) => setForm({ ...form, contactPhone: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cPlan">Plan name</Label>
            <Input
              id="cPlan"
              value={form.planName}
              onChange={(e) => setForm({ ...form, planName: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cPrice">Monthly price (PHP)</Label>
            <Input
              id="cPrice"
              type="number"
              min={0}
              value={form.planPrice}
              onChange={(e) => setForm({ ...form, planPrice: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cGrace">Grace period (days)</Label>
            <Input
              id="cGrace"
              type="number"
              min={0}
              max={90}
              value={form.gracePeriodDays}
              onChange={(e) => setForm({ ...form, gracePeriodDays: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cAdmin">Invite admin (optional)</Label>
            <Input
              id="cAdmin"
              type="email"
              value={form.adminEmail}
              onChange={(e) => setForm({ ...form, adminEmail: e.target.value })}
              placeholder="operator@example.com"
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2 sm:col-span-2">
            <div>
              <p className="text-sm font-medium">Customer signup link enabled</p>
              <p className="text-xs text-muted-foreground">Customers can join through /join/{preview || "slug"}.</p>
            </div>
            <Switch
              checked={form.signupEnabled}
              onCheckedChange={(v) => setForm({ ...form, signupEnabled: v })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={saving}>
            {saving ? "Creating…" : "Create ecosystem"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ManageDialog({
  row,
  onClose,
  onSaved,
  onInvite,
  onCopy,
}: {
  row: Overview;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onInvite: (row: Overview) => void;
  onCopy: (value: string, label?: string) => void;
}) {
  const [state, setState] = useState({
    name: row.name,
    description: row.description ?? "",
    contactEmail: row.contact_email ?? "",
    contactPhone: row.contact_phone ?? "",
    signupEnabled: row.signup_enabled,
    planName: row.plan_name,
    planPrice: String(row.plan_price),
    gracePeriodDays: String(row.grace_period_days),
  });
  const [saving, setSaving] = useState(false);
  const url = `${origin()}/join/${row.slug}`;

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.rpc("update_ecosystem", {
      _ecosystem_id: row.id,
      _name: state.name,
      _description: state.description,
      _contact_email: state.contactEmail,
      _contact_phone: state.contactPhone,
      _signup_enabled: state.signupEnabled,
    });
    if (error) {
      setSaving(false);
      toast.error("Could not save", { description: error.message });
      return;
    }
    const { error: planErr } = await supabase.rpc("update_ecosystem_plan", {
      _ecosystem_id: row.id,
      _plan_name: state.planName,
      _plan_price: Number(state.planPrice) || 0,
      _grace_period_days: Number(state.gracePeriodDays) || 0,
    });
    setSaving(false);
    if (planErr) {
      toast.error("Settings saved, plan update failed", { description: planErr.message });
    } else {
      toast.success("Ecosystem updated");
    }
    await onSaved();
    onClose();
  };

  const rotate = async () => {
    const { error } = await supabase.rpc("regenerate_signup_token", { _ecosystem_id: row.id });
    if (error) {
      toast.error("Could not rotate the link key", { description: error.message });
      return;
    }
    toast.success("Link key rotated and audit-logged");
    await onSaved();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{row.name}</DialogTitle>
          <DialogDescription>
            Subscription {statusLabel[row.subscription_state] ?? row.subscription_state} ·{" "}
            {row.admin_count} admin{Number(row.admin_count) === 1 ? "" : "s"} · {row.member_count} members
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="mUrl">Customer signup URL</Label>
          <div className="flex gap-2">
            <Input id="mUrl" readOnly value={url} className="font-mono text-xs" />
            <Button variant="outline" onClick={() => onCopy(url)}>
              <Copy className="size-4" />
            </Button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="mName">Name</Label>
            <Input
              id="mName"
              value={state.name}
              onChange={(e) => setState({ ...state, name: e.target.value })}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="mDesc">Description</Label>
            <Textarea
              id="mDesc"
              rows={2}
              value={state.description}
              onChange={(e) => setState({ ...state, description: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mEmail">Contact email</Label>
            <Input
              id="mEmail"
              value={state.contactEmail}
              onChange={(e) => setState({ ...state, contactEmail: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mPhone">Contact phone</Label>
            <Input
              id="mPhone"
              value={state.contactPhone}
              onChange={(e) => setState({ ...state, contactPhone: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mPlan">Plan name</Label>
            <Input
              id="mPlan"
              value={state.planName}
              onChange={(e) => setState({ ...state, planName: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mPrice">Monthly price (PHP)</Label>
            <Input
              id="mPrice"
              type="number"
              min={0}
              value={state.planPrice}
              onChange={(e) => setState({ ...state, planPrice: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mGrace">Grace period (days)</Label>
            <Input
              id="mGrace"
              type="number"
              min={0}
              max={90}
              value={state.gracePeriodDays}
              onChange={(e) => setState({ ...state, gracePeriodDays: e.target.value })}
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2 sm:col-span-2">
            <div>
              <p className="text-sm font-medium">Customer signups</p>
              <p className="text-xs text-muted-foreground">
                Disabling stops the link resolving; the ecosystem stays intact.
              </p>
            </div>
            <Switch
              checked={state.signupEnabled}
              onCheckedChange={(v) => setState({ ...state, signupEnabled: v })}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={rotate}>
            Rotate link key
          </Button>
          <Button variant="outline" size="sm" onClick={() => onInvite(row)}>
            <UserPlus className="size-4" /> Invite admin
          </Button>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
