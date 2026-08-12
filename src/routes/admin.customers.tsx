import { createFileRoute, Link } from "@tanstack/react-router";
import { Link2, Percent, Search, ShieldCheck, TrendingUp, UserCog } from "lucide-react";
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
import {
  fetchEcosystemCommission,
  fetchEcosystemSaleCommission,
  setResellerCommission,
  setSaleCommission,
  setSubresellerParent,
  type SaleCommissionDefaults,
} from "@/lib/wallet";

export const Route = createFileRoute("/admin/customers")({
  head: () => ({
    meta: [
      { title: "Customers — WaveWallet Admin" },
      {
        name: "description",
        content: "All customer accounts in your ecosystem, with reseller promotion and discount control.",
      },
      { property: "og:title", content: "Customers — WaveWallet Admin" },
      {
        property: "og:description",
        content: "All customer accounts in your ecosystem, with reseller promotion and discount control.",
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
  /** Customer-purchase credit-back override (reseller or subreseller). */
  sale_commission_percent: number | null;
  /** Parent reseller — mandatory owner of a subreseller. */
  reseller_id: string | null;
  role: Role;
  credits: number;
  points: number;
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
  const [commission, setCommission] = useState("20");
  const [creditBack, setCreditBack] = useState("10");
  const [defaultCommission, setDefaultCommission] = useState(0);
  const [saleDefaults, setSaleDefaults] = useState<SaleCommissionDefaults>({
    reseller: 0,
    subreseller: 0,
  });
  const [editingCommission, setEditingCommission] = useState<Member | null>(null);
  const [editingCreditBack, setEditingCreditBack] = useState<Member | null>(null);
  const [editingOwner, setEditingOwner] = useState<Member | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!ecosystemDbId) return;
    setLoading(true);
    const [{ data: profiles }, { data: roles }, { data: credits }, { data: points }] =
      await Promise.all([
        supabase
          .from("profiles")
          .select(
            "id, full_name, email, phone, joined_at, status, reseller_discount_percent, reseller_commission_percent, sale_commission_percent, reseller_id",
          )
          .eq("ecosystem_id", ecosystemDbId)
          .order("joined_at", { ascending: false }),
        supabase.from("user_roles").select("user_id, role").eq("ecosystem_id", ecosystemDbId),
        supabase.from("credit_accounts").select("user_id, balance").eq("ecosystem_id", ecosystemDbId),
        supabase.from("points_accounts").select("user_id, balance").eq("ecosystem_id", ecosystemDbId),
      ]);

    const roleOf = new Map<string, Member["role"]>();
    for (const r of roles ?? []) {
      const current = roleOf.get(r.user_id);
      const rank = (x: string) => (x === "reseller" ? 0 : x === "subreseller" ? 1 : 2);
      if (!current || rank(r.role) < rank(current)) roleOf.set(r.user_id, r.role as Member["role"]);
    }
    const creditOf = new Map((credits ?? []).map((c) => [c.user_id, Number(c.balance)]));
    const pointOf = new Map((points ?? []).map((p) => [p.user_id, Number(p.balance)]));

    setMembers(
      (profiles ?? []).map((p) => ({
        ...p,
        role: roleOf.get(p.id) ?? "customer",
        credits: creditOf.get(p.id) ?? 0,
        points: pointOf.get(p.id) ?? 0,
      }) as Member),
    );
    setLoading(false);
  }, [ecosystemDbId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Shop-wide defaults: credit-loading commission and sales credit-back are
  // configured separately, so changing one never moves the other.
  useEffect(() => {
    if (!ecosystemDbId) return;
    void fetchEcosystemCommission(ecosystemDbId).then((v) => {
      setDefaultCommission(v);
      setCommission(String(v));
    });
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
      if (!needle) return true;
      return (
        c.full_name.toLowerCase().includes(needle) ||
        c.email.toLowerCase().includes(needle) ||
        c.phone.includes(needle)
      );
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
    // Credit-LOADING commission is reseller-only; subresellers never earn it.
    if (promoteTo === "reseller") {
      const bonus = Number(commission);
      if (!Number.isNaN(bonus) && bonus > 0) {
        try {
          await setResellerCommission(promoting.id, bonus);
        } catch (err) {
          toast.error((err as Error).message);
        }
      }
    }
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

  const confirmCommission = async () => {
    if (!editingCommission) return;
    const value = Number(commission);
    if (Number.isNaN(value) || value < 0 || value > MAX_COMMISSION) {
      toast.error(`Commission must be between 0% and ${MAX_COMMISSION}%.`);
      return;
    }
    setBusy(true);
    try {
      await setResellerCommission(editingCommission.id, value);
      toast.success("Commission updated — applies to future credit releases only.");
      setEditingCommission(null);
      void load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const confirmCreditBack = async () => {
    if (!editingCreditBack) return;
    const value = Number(creditBack);
    if (Number.isNaN(value) || value < 0 || value > MAX_COMMISSION) {
      toast.error(`Credit-back must be between 0% and ${MAX_COMMISSION}%.`);
      return;
    }
    setBusy(true);
    try {
      await setSaleCommission(editingCreditBack.id, value);
      toast.success("Credit-back updated — applies to future customer purchases only.");
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

      <PageSection
        title="Customer directory"
        description="Scoped strictly to this ecosystem by database row-level security."
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
                              {c.role === "reseller" ? (
                                <StatusBadge tone="brand">
                                  {c.reseller_commission_percent ?? defaultCommission}% loading
                                  {c.reseller_commission_percent === null ? " (default)" : ""}
                                </StatusBadge>
                              ) : (
                                <StatusBadge tone="muted">No loading commission</StatusBadge>
                              )}
                              <StatusBadge tone="brand">
                                {c.sale_commission_percent ??
                                  (c.role === "reseller"
                                    ? saleDefaults.reseller
                                    : saleDefaults.subreseller)}
                                % credit-back
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
                            {c.role === "reseller" ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setEditingCommission(c);
                                  setCommission(
                                    String(c.reseller_commission_percent ?? defaultCommission),
                                  );
                                }}
                              >
                                <Percent className="size-4" /> Loading %
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
                                <Percent className="size-4" /> Credit-back %
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
                            {c.role === "customer" ? (
                              <Button
                                size="sm"
                                onClick={() => {
                                  setPromoting(c);
                                  setPromoteTo("reseller");
                                  setParentId("");
                                  setDiscount("10");
                                  setCommission("20");
                                }}
                              >
                                <ShieldCheck className="size-4" /> Promote
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
                    Reseller — discount + loading commission + credit-back
                  </SelectItem>
                  <SelectItem value="subreseller">
                    Subreseller — discount + credit-back, no loading commission
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
            <div className={promoteTo === "reseller" ? "space-y-1.5" : "hidden"}>
              <Label htmlFor="promoteCommission">Credit commission bonus (%)</Label>
              <Input
                id="promoteCommission"
                type="number"
                min={0}
                max={MAX_COMMISSION}
                value={commission}
                onChange={(e) => setCommission(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">
                When you release {peso(1000)} to this reseller they receive{" "}
                {peso(1000 * (1 + (Number(commission) || 0) / 100))} — you are debited{" "}
                {peso(1000)} only.
              </p>
            </div>
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

      <Dialog open={!!editingCommission} onOpenChange={(o) => !o && setEditingCommission(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Credit commission bonus</DialogTitle>
            <DialogDescription>
              Extra credits granted to {editingCommission?.full_name || editingCommission?.email}{" "}
              whenever you or the platform owner release credits to them. Applies to future
              transfers only — past transactions keep the rate they were made with.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="editCommission">Commission (%)</Label>
            <Input
              id="editCommission"
              type="number"
              min={0}
              max={MAX_COMMISSION}
              value={commission}
              onChange={(e) => setCommission(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              Send {peso(1000)} → reseller receives{" "}
              {peso(1000 * (1 + (Number(commission) || 0) / 100))} (
              {Number(commission) || 0}% bonus). Your wallet is debited {peso(1000)}.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditingCommission(null)}>
              Cancel
            </Button>
            <Button onClick={confirmCommission} disabled={busy}>
              Save commission
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
                    ? `Reseller · ${detail.reseller_discount_percent}% discount · ${detail.reseller_commission_percent ?? defaultCommission}% commission${detail.reseller_commission_percent === null ? " (shop default)" : ""}`
                    : detail.role === "subreseller"
                      ? `Subreseller · ${detail.reseller_discount_percent}% discount · no commission`
                      : "Customer"}
                </StatusBadge>
                <StatusBadge tone={detail.status === "active" ? "success" : "danger"}>
                  {detail.status}
                </StatusBadge>
              </div>

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
    </>
  );
}
