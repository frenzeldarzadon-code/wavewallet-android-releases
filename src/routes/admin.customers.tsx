import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Link2,
  Pencil,
  Percent,
  Repeat,
  Search,
  ShieldCheck,
  Trash2,
  UserCheck,
  TrendingUp,
  UserCog,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, PageSection, StatCard, StatusBadge } from "@/components/ui-kit";
import { useSession } from "@/lib/session";
import { supabase } from "@/integrations/supabase/client";
import { peso, roleLabel, shortDate, shortDateTime, type Role } from "@/lib/wavewallet";
import { EditMemberDialog, type EditableMember } from "@/components/edit-member-dialog";
import { memberMatches } from "@/lib/member-admin";
import { InviteMemberCard } from "@/components/invite-member-card";
import { AccessAccountDialog, type AccessTarget } from "@/components/access-account-dialog";
import { isImpersonatable } from "@/lib/impersonation";
import {
  evaluateCustomerDeletion,
  type DeletionVerdict,
} from "@/lib/customer-cleanup";
import { deleteCustomerAccount } from "@/lib/customer-cleanup.functions";
import {
  fetchEcosystemSaleCommission,
  setSaleCommission,
  setSubresellerParent,
  type SaleCommissionDefaults,
} from "@/lib/wallet";
import { Textarea } from "@/components/ui/textarea";
import {
  evaluateRestructure,
  fetchRestructureCheck,
  isRestructurable,
  restructureMemberRole,
  targetRolesFor,
  type RestructureCheck,
  type RestructureTargetRole,
} from "@/lib/role-restructure";

export const Route = createFileRoute("/admin/customers")({
  head: () => ({
    meta: [
      { title: "Customers — WaveWallet Admin" },
      {
        name: "description",
        content: "All customer accounts in your shop, with reseller promotion and discount control.",
      },
      { property: "og:title", content: "Customers — WaveWallet Admin" },
      {
        property: "og:description",
        content: "All customer accounts in your shop, with reseller promotion and discount control.",
      },
    ],
  }),
  component: AdminCustomers,
});

interface Member {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  joined_at: string;
  status: "active" | "suspended";
  reseller_discount_percent: number;
  /** Credit-LOADING commission override (resellers only). */
  reseller_commission_percent: number | null;
  /** Sales commission override (reseller or subreseller). */
  sale_commission_percent: number | null;
  /** Parent reseller — mandatory owner of a subreseller. */
  reseller_id: string | null;
  role: Role;
  credits: number;
  points: number;
  pointsHeld: number;
  pendingRedemptions: number;
  deleted_at: string | null;
}

interface ActivityRow {
  id: string;
  action: string;
  target: string;
  actor_name: string;
  created_at: string;
}

const MAX_DISCOUNT = 50;
const MAX_COMMISSION = 100;

function AdminCustomers() {
  const { ecosystem, ecosystemDbId } = useSession("admin");
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "customer" | "reseller" | "subreseller">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "suspended">("all");
  const [promoting, setPromoting] = useState<Member | null>(null);
  const [promoteTo, setPromoteTo] = useState<"reseller" | "subreseller">("reseller");
  const [parentId, setParentId] = useState<string>("");
  const [editing, setEditing] = useState<Member | null>(null);
  const [detail, setDetail] = useState<Member | null>(null);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [discount, setDiscount] = useState("10");
  const [creditBack, setCreditBack] = useState("10");
  const [saleDefaults, setSaleDefaults] = useState<SaleCommissionDefaults>({
    reseller: 0,
    subreseller: 0,
  });
  const [editingCreditBack, setEditingCreditBack] = useState<Member | null>(null);
  const [editingOwner, setEditingOwner] = useState<Member | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<Member | null>(null);
  // Organization restructuring (reseller <-> subreseller, or step down to customer).
  const [restructuring, setRestructuring] = useState<Member | null>(null);
  const [restructureCheck, setRestructureCheck] = useState<RestructureCheck | null>(null);
  const [restructureRole, setRestructureRole] = useState<RestructureTargetRole | "">("");
  const [restructureParent, setRestructureParent] = useState("");
  const [childParents, setChildParents] = useState<Record<string, string>>({});
  const [restructureReason, setRestructureReason] = useState("");
  const [editingProfile, setEditingProfile] = useState<EditableMember | null>(null);
  // Secure act-as: entering a member account is a server-side delegation.
  const [accessing, setAccessing] = useState<AccessTarget | null>(null);

  const load = useCallback(async () => {
    if (!ecosystemDbId) return;
    setLoading(true);
    const [
      { data: profiles },
      { data: roles },
      { data: credits },
      { data: points },
      { data: pending },
    ] = await Promise.all([
        supabase
          .from("profiles")
          .select(
            "id, full_name, email, phone, joined_at, status, reseller_discount_percent, reseller_commission_percent, sale_commission_percent, reseller_id, deleted_at",
          )
          .eq("ecosystem_id", ecosystemDbId)
          .order("joined_at", { ascending: false }),
        supabase.from("user_roles").select("user_id, role").eq("ecosystem_id", ecosystemDbId),
        supabase.from("credit_accounts").select("user_id, balance").eq("ecosystem_id", ecosystemDbId),
        supabase
          .from("points_accounts")
          .select("user_id, balance, held")
          .eq("ecosystem_id", ecosystemDbId),
        supabase
          .from("reward_redemptions")
          .select("user_id, status")
          .eq("ecosystem_id", ecosystemDbId)
          .in("status", ["pending", "approved"]),
      ]);

    const roleOf = new Map<string, Member["role"]>();
    for (const r of roles ?? []) {
      const current = roleOf.get(r.user_id);
      const rank = (x: string) => (x === "reseller" ? 0 : x === "subreseller" ? 1 : 2);
      if (!current || rank(r.role) < rank(current)) roleOf.set(r.user_id, r.role as Member["role"]);
    }
    const creditOf = new Map((credits ?? []).map((c) => [c.user_id, Number(c.balance)]));
    const pointOf = new Map((points ?? []).map((p) => [p.user_id, Number(p.balance)]));
    const heldOf = new Map((points ?? []).map((p) => [p.user_id, Number(p.held)]));
    const pendingOf = new Map<string, number>();
    for (const r of pending ?? []) pendingOf.set(r.user_id, (pendingOf.get(r.user_id) ?? 0) + 1);

    setMembers(
      (profiles ?? [])
        .filter((p) => !p.deleted_at)
        .map((p) => ({
          ...p,
          role: roleOf.get(p.id) ?? "customer",
          credits: creditOf.get(p.id) ?? 0,
          points: pointOf.get(p.id) ?? 0,
          pointsHeld: heldOf.get(p.id) ?? 0,
          pendingRedemptions: pendingOf.get(p.id) ?? 0,
        }) as Member),
    );
    setLoading(false);
  }, [ecosystemDbId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Shop-wide sales commission defaults. Credit transfers pay nothing, so the
  // old loading-commission default no longer exists.
  useEffect(() => {
    if (!ecosystemDbId) return;
    void fetchEcosystemSaleCommission(ecosystemDbId).then(setSaleDefaults);
  }, [ecosystemDbId]);

  const openDetail = async (m: Member) => {
    setDetail(m);
    setActivity([]);
    if (!ecosystemDbId) return;
    const { data } = await supabase
      .from("audit_logs")
      .select("id, action, target, actor_name, created_at")
      .eq("ecosystem_id", ecosystemDbId)
      .or(`actor_id.eq.${m.id},target.ilike.%${m.email}%`)
      .order("created_at", { ascending: false })
      .limit(8);
    setActivity((data as ActivityRow[] | null) ?? []);
  };

  const customers = useMemo(
    () =>
      members.filter(
        (m) => m.role === "customer" || m.role === "reseller" || m.role === "subreseller",
      ),
    [members],
  );
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return customers.filter((c) => {
      if (roleFilter !== "all" && c.role !== roleFilter) return false;
      if (statusFilter !== "all" && c.status !== statusFilter) return false;
      return memberMatches(c, needle);
    });
  }, [customers, q, roleFilter, statusFilter]);
  const resellers = customers.filter((c) => c.role === "reseller");
  const subresellers = customers.filter((c) => c.role === "subreseller");

  if (!ecosystem) return null;

  const nameOf = (id: string | null) =>
    id ? (members.find((m) => m.id === id)?.full_name ?? "—") : "—";

  const confirmPromote = async () => {
    if (!promoting) return;
    const value = Number(discount);
    if (Number.isNaN(value) || value < 0 || value > MAX_DISCOUNT) {
      toast.error(`Discount must be between 0% and ${MAX_DISCOUNT}%.`);
      return;
    }
    // A subreseller must always belong to exactly one parent reseller.
    if (promoteTo === "subreseller" && !parentId) {
      toast.error("Choose the parent reseller this subreseller belongs to.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc(
      promoteTo === "subreseller" ? "promote_to_subreseller" : "promote_to_reseller",
      promoteTo === "subreseller"
        ? { _user_id: promoting.id, _discount: value, _parent_reseller_id: parentId }
        : { _user_id: promoting.id, _discount: value },
    );
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    // New members start on the shop-wide sales commission default; set a
    // personal rate afterwards with the "Sales %" action if needed.

    toast.success(
      `${promoting.full_name} is now a ${roleLabel(promoteTo).toLowerCase()} — history preserved.`,
    );
    setPromoting(null);
    setParentId("");
    void load();
  };


  const confirmDiscount = async () => {
    if (!editing) return;
    const value = Number(discount);
    if (Number.isNaN(value) || value < 0 || value > MAX_DISCOUNT) {
      toast.error(`Discount must be between 0% and ${MAX_DISCOUNT}%.`);
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc("set_reseller_discount", {
      _user_id: editing.id,
      _discount: value,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Discount updated — applies to future voucher purchases only.");
    setEditing(null);
    void load();
  };

  const confirmCreditBack = async () => {
    if (!editingCreditBack) return;
    const value = Number(creditBack);
    if (Number.isNaN(value) || value < 0 || value > MAX_COMMISSION) {
      toast.error(`Sales commission must be between 0% and ${MAX_COMMISSION}%.`);
      return;
    }
    setBusy(true);
    try {
      await setSaleCommission(editingCreditBack.id, value);
      toast.success("Sales commission updated — applies to future purchases only.");
      setEditingCreditBack(null);
      void load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const confirmOwner = async () => {
    if (!editingOwner || !parentId) return;
    setBusy(true);
    try {
      await setSubresellerParent(editingOwner.id, parentId);
      toast.success("Parent reseller updated.");
      setEditingOwner(null);
      setParentId("");
      void load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const openRestructure = async (m: Member) => {
    setRestructuring(m);
    setRestructureCheck(null);
    setRestructureRole(isRestructurable(m.role) ? targetRolesFor(m.role)[0]! : "");
    setRestructureParent("");
    setChildParents({});
    setRestructureReason("");
    try {
      setRestructureCheck(await fetchRestructureCheck(m.id));
    } catch (e) {
      toast.error((e as Error).message);
      setRestructuring(null);
    }
  };

  const restructureOptions: RestructureTargetRole[] =
    restructuring && isRestructurable(restructuring.role) ? targetRolesFor(restructuring.role) : [];

  const restructureTarget: RestructureTargetRole | null =
    restructureRole && restructureOptions.includes(restructureRole) ? restructureRole : null;

  const restructureVerdict =
    restructureCheck && restructureTarget
      ? evaluateRestructure(restructureCheck, {
          newRole: restructureTarget,
          parentResellerId: restructureParent,
          childReassignments: childParents,
          reason: restructureReason,
        })
      : null;

  const closeRestructure = () => {
    setRestructuring(null);
    setRestructureCheck(null);
    setRestructureRole("");
    setRestructureParent("");
    setChildParents({});
    setRestructureReason("");
  };

  const confirmRestructure = async () => {
    if (!restructuring || !restructureTarget || !restructureVerdict?.ok) return;
    setBusy(true);
    try {
      await restructureMemberRole(restructuring.id, {
        newRole: restructureTarget,
        parentResellerId: restructureParent,
        childReassignments: childParents,
        reason: restructureReason,
      });
      toast.success(
        `${restructuring.full_name || restructuring.email} is now a ${roleLabel(restructureTarget).toLowerCase()} — wallet, history and earnings untouched.`,
      );
      closeRestructure();
      void load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };


  const verdictFor = (m: Member): DeletionVerdict =>
    evaluateCustomerDeletion({
      role: m.role,
      joinedAt: m.joined_at,
      credits: m.credits,
      points: m.points,
      pointsHeld: m.pointsHeld,
      pendingRedemptions: m.pendingRedemptions,
      deletedAt: m.deleted_at,
    });

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await deleteCustomerAccount({ data: { userId: deleting.id } });
      toast.success("Customer account deleted and anonymised — financial history is preserved.");
      setDeleting(null);
      void load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleStatus = async (m: Member) => {
    const next = m.status === "active" ? "suspended" : "active";
    const { error } = await supabase.rpc("set_member_status", {
      _user_id: m.id,
      _status: next,
    });
    if (error) {
      toast.error("Could not update status", { description: error.message });
      return;
    }
    toast.success(`${m.full_name || m.email} is now ${next}.`);
    setDetail(null);
    void load();
  };

  return (
    <>
      <PageSection>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Members" value={String(customers.length)} tone="brand" />
          <StatCard label="Resellers" value={String(resellers.length)} tone="positive" />
          <StatCard label="Subresellers" value={String(subresellers.length)} tone="brand" />
          <StatCard
            label="Suspended"
            value={String(customers.filter((c) => c.status !== "active").length)}
            tone="negative"
          />
        </div>
      </PageSection>

      <PageSection>
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <Link2 className="mt-0.5 size-5 text-primary" />
              <div>
                <p className="text-sm font-medium">Grow this list with your signup link</p>
                <p className="text-xs text-muted-foreground">
                  Anyone who opens /join/{ecosystem.slug} joins {ecosystem.name} as a customer.
                </p>
              </div>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link to="/admin/signup-link">Open signup link</Link>
            </Button>
          </CardContent>
        </Card>
      </PageSection>

      <InviteMemberCard ecosystemId={ecosystemDbId} />



      <PageSection
        title="Customer directory"
        description="Scoped strictly to this shop by database row-level security."
      >
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name, email or mobile"
              className="pl-9"
            />
          </div>
          <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v as typeof roleFilter)}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All roles</SelectItem>
              <SelectItem value="customer">Customers</SelectItem>
              <SelectItem value="reseller">Resellers</SelectItem>
              <SelectItem value="subreseller">Subresellers</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="suspended">Suspended</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Card className="overflow-hidden shadow-[var(--shadow-card)]">
          <CardContent className="px-0">
            {loading ? (
              <p className="px-5 py-8 text-center text-sm text-muted-foreground">Loading members…</p>
            ) : filtered.length === 0 ? (
              <EmptyState
                title="No members match"
                description="Share your signup link — new customers appear here the moment they confirm their account."
              />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Member</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Wallets</TableHead>
                      <TableHead>Joined</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell>
                          <p className="font-medium">{c.full_name || c.email}</p>
                          <p className="text-xs text-muted-foreground">{c.email}</p>
                          {c.phone ? <p className="text-xs text-muted-foreground">{c.phone}</p> : null}
                          {c.status !== "active" ? (
                            <StatusBadge tone="danger" className="mt-1">
                              Suspended
                            </StatusBadge>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          {c.role === "reseller" || c.role === "subreseller" ? (
                            <div className="flex flex-wrap gap-1">
                              <StatusBadge tone="success">
                                {roleLabel(c.role)} · {c.reseller_discount_percent}% off
                              </StatusBadge>
                              <StatusBadge tone="brand">
                                {c.sale_commission_percent ??
                                  (c.role === "reseller"
                                    ? saleDefaults.reseller
                                    : saleDefaults.subreseller)}
                                % sales commission
                                {c.sale_commission_percent === null ? " (default)" : ""}
                              </StatusBadge>
                              {c.role === "subreseller" ? (
                                <StatusBadge tone="muted">
                                  Parent: {nameOf(c.reseller_id)}
                                </StatusBadge>
                              ) : null}
                            </div>
                          ) : (
                            <StatusBadge tone="muted">Customer</StatusBadge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          <p className="text-success">{peso(c.credits)}</p>
                          <p className="text-xs text-muted-foreground">{c.points} pts</p>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {shortDate(c.joined_at)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex flex-wrap justify-end gap-2">
                            <Button size="sm" variant="ghost" onClick={() => void openDetail(c)}>
                              <UserCog className="size-4" /> Details
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditingProfile(c)}>
                              <Pencil className="size-4" /> Edit
                            </Button>
                            {isImpersonatable(c.role) && c.status === "active" ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  setAccessing({
                                    id: c.id,
                                    name: c.full_name || c.email,
                                    role: c.role,
                                  })
                                }
                              >
                                <UserCheck className="size-4" /> Access account
                              </Button>
                            ) : null}
                            {c.role === "reseller" || c.role === "subreseller" ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setEditing(c);
                                  setDiscount(String(c.reseller_discount_percent));
                                }}
                              >
                                <TrendingUp className="size-4" /> Discount
                              </Button>
                            ) : null}
                            {c.role === "reseller" || c.role === "subreseller" ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setEditingCreditBack(c);
                                  setCreditBack(
                                    String(
                                      c.sale_commission_percent ??
                                        (c.role === "reseller"
                                          ? saleDefaults.reseller
                                          : saleDefaults.subreseller),
                                    ),
                                  );
                                }}
                              >
                                <Percent className="size-4" /> Sales %
                              </Button>
                            ) : null}
                            {c.role === "subreseller" ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setEditingOwner(c);
                                  setParentId(c.reseller_id ?? "");
                                }}
                              >
                                <UserCog className="size-4" /> Parent
                              </Button>
                            ) : null}
                            {c.role === "reseller" || c.role === "subreseller" ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => void openRestructure(c)}
                              >
                                <Repeat className="size-4" /> Change role
                              </Button>
                            ) : null}
                            {c.role === "customer" ? (
                              <Button
                                size="sm"
                                onClick={() => {
                                  setPromoting(c);
                                  setPromoteTo("reseller");
                                  setParentId("");
                                  setDiscount("10");
                                }}
                              >
                                <ShieldCheck className="size-4" /> Promote
                              </Button>
                            ) : null}
                            {c.role === "customer" && verdictFor(c).eligible ? (
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => setDeleting(c)}
                              >
                                <Trash2 className="size-4" /> Delete
                              </Button>
                            ) : null}
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

      <Dialog open={!!promoting} onOpenChange={(o) => !o && setPromoting(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Promote member</DialogTitle>
            <DialogDescription>
              {promoting?.full_name || promoting?.email} keeps every credit, point, purchase and
              ledger entry. The change is written to the audit trail.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="promoteRole">New role</Label>
              <Select
                value={promoteTo}
                onValueChange={(v) => setPromoteTo(v as "reseller" | "subreseller")}
              >
                <SelectTrigger id="promoteRole">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="reseller">
                    Reseller — wholesale discount + sales commission
                  </SelectItem>
                  <SelectItem value="subreseller">
                    Subreseller — wholesale discount + sales cashback, parent earns upline
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            {promoteTo === "subreseller" ? (
              <div className="space-y-1.5">
                <Label htmlFor="promoteParent">Parent reseller</Label>
                <Select value={parentId} onValueChange={setParentId}>
                  <SelectTrigger id="promoteParent">
                    <SelectValue placeholder="Choose the owning reseller" />
                  </SelectTrigger>
                  <SelectContent>
                    {resellers.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.full_name || r.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  A subreseller belongs to exactly one reseller and can only be loaded by that
                  reseller or by you.
                </p>
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="promoteDiscount">Voucher discount (%)</Label>
              <Input
                id="promoteDiscount"
                type="number"
                min={0}
                max={MAX_DISCOUNT}
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              They buy vouchers at {100 - (Number(discount) || 0)}% of the customer price and sell
              at the normal customer price — the discount is their margin.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPromoting(null)}>
              Cancel
            </Button>
            <Button onClick={confirmPromote} disabled={busy}>
              Confirm promotion
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{roleLabel(editing?.role ?? "reseller")} discount</DialogTitle>
            <DialogDescription>
              Applies to future voucher purchases by {editing?.full_name || editing?.email} only.
              Past purchases keep the price and discount they were made with.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="editDiscount">Discount (%)</Label>
            <Input
              id="editDiscount"
              type="number"
              min={0}
              max={MAX_DISCOUNT}
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={confirmDiscount} disabled={busy}>
              Save discount
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingCreditBack} onOpenChange={(o) => !o && setEditingCreditBack(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Sales commission</DialogTitle>
            <DialogDescription>
              Paid to {editingCreditBack?.full_name || editingCreditBack?.email} when a customer
              spends credits this member funded, and on their own voucher purchases. Separate from
              the wholesale discount, and snapshotted on every sale — past sales never change.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="editCreditBack">Sales commission (%)</Label>
            <Input
              id="editCreditBack"
              type="number"
              min={0}
              max={MAX_COMMISSION}
              value={creditBack}
              onChange={(e) => setCreditBack(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              Shop defaults: {saleDefaults.reseller}% for resellers, {saleDefaults.subreseller}% for
              subresellers.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditingCreditBack(null)}>
              Cancel
            </Button>
            <Button onClick={confirmCreditBack} disabled={busy}>
              Save commission
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!editingOwner}
        onOpenChange={(o) => {
          if (!o) {
            setEditingOwner(null);
            setParentId("");
          }
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Parent reseller</DialogTitle>
            <DialogDescription>
              {editingOwner?.full_name || editingOwner?.email} can only be loaded by their parent
              reseller or by you. Moving them is audit-logged; past transactions keep their original
              attribution.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="editParent">Owning reseller</Label>
            <Select value={parentId} onValueChange={setParentId}>
              <SelectTrigger id="editParent">
                <SelectValue placeholder="Choose a reseller" />
              </SelectTrigger>
              <SelectContent>
                {resellers.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.full_name || r.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setEditingOwner(null);
                setParentId("");
              }}
            >
              Cancel
            </Button>
            <Button onClick={confirmOwner} disabled={busy || !parentId}>
              Save parent
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!restructuring} onOpenChange={(o) => !o && closeRestructure()}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Change organisation role</DialogTitle>
            <DialogDescription>
              {restructuring?.full_name || restructuring?.email} keeps the same account, ecosystem,
              wallet, points, purchases and earnings. Only the role and hierarchy change, from now
              on.
            </DialogDescription>
          </DialogHeader>

          {!restructureCheck ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Checking hierarchy…</p>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">Current role</p>
                  <p className="font-medium">{roleLabel(restructuring!.role)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Parent: {restructureCheck.parent_reseller_name ?? "—"}
                  </p>
                </div>
                <div className="rounded-md border border-primary/40 bg-primary/5 p-3">
                  <p className="text-xs text-muted-foreground">Proposed role</p>
                  <p className="font-medium text-primary">
                    {restructureTarget ? roleLabel(restructureTarget) : "—"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Wallet: {peso(restructureCheck.credits)} · {restructureCheck.points} pts
                    (unchanged)
                  </p>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="restructureRole">New role</Label>
                <Select
                  value={restructureRole}
                  onValueChange={(v) => setRestructureRole(v as RestructureTargetRole)}
                >
                  <SelectTrigger id="restructureRole">
                    <SelectValue placeholder="Choose the new role" />
                  </SelectTrigger>
                  <SelectContent>
                    {restructureOptions.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r === "customer"
                          ? "Customer — stops reselling, keeps the same login"
                          : r === "reseller"
                            ? "Reseller — top level, no upline"
                            : "Subreseller — belongs to a reseller"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {restructureTarget === "subreseller" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="restructureParent">New parent reseller</Label>
                  <Select value={restructureParent} onValueChange={setRestructureParent}>
                    <SelectTrigger id="restructureParent">
                      <SelectValue placeholder="Choose a reseller" />
                    </SelectTrigger>
                    <SelectContent>
                      {resellers
                        .filter((r) => r.id !== restructuring?.id)
                        .map((r) => (
                          <SelectItem key={r.id} value={r.id}>
                            {r.full_name || r.email}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              {(restructureTarget === "subreseller" || restructureTarget === "customer") &&
              restructureCheck.children.length > 0 ? (
                <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
                  <p className="text-sm font-medium text-destructive">
                    {restructureCheck.children.length} subreseller
                    {restructureCheck.children.length === 1 ? "" : "s"} must be reassigned
                  </p>
                  {restructureCheck.children.map((child) => (
                    <div key={child.id} className="space-y-1">
                      <Label className="text-xs" htmlFor={`child-${child.id}`}>
                        {child.name || child.email}
                      </Label>
                      <Select
                        value={childParents[child.id] ?? ""}
                        onValueChange={(v) =>
                          setChildParents((prev) => ({ ...prev, [child.id]: v }))
                        }
                      >
                        <SelectTrigger id={`child-${child.id}`}>
                          <SelectValue placeholder="Choose a new reseller" />
                        </SelectTrigger>
                        <SelectContent>
                          {resellers
                            .filter((r) => r.id !== restructuring?.id && r.id !== child.id)
                            .map((r) => (
                              <SelectItem key={r.id} value={r.id}>
                                {r.full_name || r.email}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="space-y-1.5">
                <Label htmlFor="restructureReason">Reason (required, audit-logged)</Label>
                <Textarea
                  id="restructureReason"
                  rows={2}
                  value={restructureReason}
                  onChange={(e) => setRestructureReason(e.target.value)}
                  placeholder="e.g. Territory realignment agreed with the operator"
                />
              </div>

              <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                {(restructureVerdict?.notes ?? []).map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>

              {restructureVerdict && !restructureVerdict.ok ? (
                <ul className="list-disc space-y-1 rounded-md bg-destructive/10 p-3 pl-6 text-xs text-destructive">
                  {restructureVerdict.blockers.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              ) : null}

              <p className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
                This cannot be undone automatically — reverting requires another explicit role
                change. Historical commissions, upline attribution and earnings are never rewritten.
              </p>
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={closeRestructure} disabled={busy}>
              Cancel
            </Button>
            <Button
              onClick={() => void confirmRestructure()}
              disabled={busy || !restructureVerdict?.ok}
            >
              Confirm role change
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete customer account?</DialogTitle>
            <DialogDescription>
              {deleting?.full_name || deleting?.email} is eligible for cleanup:
            </DialogDescription>
          </DialogHeader>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {(deleting ? verdictFor(deleting).reasons : []).map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <p className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
            The login is disabled and the identity is anonymised. Voucher sales, credit and points
            history, commissions, discounts and redemptions stay intact under the normal one-year
            retention policy. The action is written to the audit trail.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void confirmDelete()} disabled={busy}>
              Delete account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{detail?.full_name || detail?.email}</DialogTitle>
            <DialogDescription>
              {detail?.email}
              {detail?.phone ? ` · ${detail.phone}` : ""} · joined{" "}
              {detail ? shortDate(detail.joined_at) : ""}
            </DialogDescription>
          </DialogHeader>

          {detail ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <StatCard label="Credit balance" value={peso(detail.credits)} tone="positive" />
                <StatCard label="Points balance" value={`${detail.points} pts`} tone="brand" />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge
                  tone={
                    detail.role === "reseller" || detail.role === "subreseller" ? "success" : "muted"
                  }
                >
                  {detail.role === "reseller"
                    ? `Reseller · ${detail.reseller_discount_percent}% wholesale discount · ${detail.sale_commission_percent ?? saleDefaults.reseller}% sales commission${detail.sale_commission_percent === null ? " (shop default)" : ""}`
                    : detail.role === "subreseller"
                      ? `Subreseller · ${detail.reseller_discount_percent}% discount · ${detail.sale_commission_percent ?? saleDefaults.subreseller}% sales cashback${detail.sale_commission_percent === null ? " (shop default)" : ""} · parent reseller earns upline`
                      : "Customer"}
                </StatusBadge>
                <StatusBadge tone={detail.status === "active" ? "success" : "danger"}>
                  {detail.status}
                </StatusBadge>
              </div>

              {detail.role === "customer" ? (
                verdictFor(detail).eligible ? (
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-sm font-medium">Account cleanup available</p>
                    <p className="text-xs text-muted-foreground">
                      This account holds no remaining value and can be deleted from the directory.
                    </p>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="mt-2"
                      onClick={() => {
                        setDeleting(detail);
                        setDetail(null);
                      }}
                    >
                      <Trash2 className="size-4" /> Delete account
                    </Button>
                  </div>
                ) : (
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-sm font-medium">Account cleanup not available</p>
                    <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                      {verdictFor(detail).blockers.map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>
                  </div>
                )
              ) : null}



              <div>
                <p className="mb-2 text-sm font-medium">Recent activity</p>
                {activity.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No audit entries yet.</p>
                ) : (
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {activity.map((a) => (
                      <li key={a.id} className="px-3 py-2">
                        <p className="text-sm">{a.action}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {a.actor_name} · {shortDateTime(a.created_at)}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <DialogFooter>
                <Button variant="ghost" onClick={() => setDetail(null)}>
                  Close
                </Button>
                <Button
                  variant={detail.status === "active" ? "destructive" : "default"}
                  onClick={() => toggleStatus(detail)}
                >
                  {detail.status === "active" ? "Suspend account" : "Reactivate account"}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <EditMemberDialog
        member={editingProfile}
        onClose={() => setEditingProfile(null)}
        onSaved={() => void load()}
      />

      <AccessAccountDialog target={accessing} onClose={() => setAccessing(null)} />
    </>
  );
}
