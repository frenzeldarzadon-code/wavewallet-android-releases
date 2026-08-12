import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, RotateCcw, Search, UserCog, Wallet } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { EditMemberDialog, type EditableMember } from "@/components/edit-member-dialog";
import { memberMatches } from "@/lib/member-admin";

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
import { EmptyState, PageSection, StatCard, StatusBadge } from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/lib/session";
import { peso, shortDateTime } from "@/lib/wavewallet";
import {
  adminAdjustCredits,
  commissionBreakdown,
  LEDGER_COLUMNS,
  normalizeEntry,
  type CreditEntry,
} from "@/lib/wallet";
import { adminAdjustPoints } from "@/lib/rewards";
import {
  fetchReversalHistory,
  fetchReversalInfo,
  isReversibleTransferEntry,
  reverseCreditTransfer,
  REVERSAL_REASONS,
  validateReversalAmount,
  type ReversalInfo,
  type ReversalRecord,
} from "@/lib/transfer-reversal";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/wallets")({
  head: () => ({
    meta: [
      { title: "Wallet Management — WaveWallet Admin" },
      {
        name: "description",
        content:
          "Search customers and resellers, review credit balances and add credits with a reason, reference and audited transaction ID.",
      },
      { property: "og:title", content: "Wallet Management — WaveWallet Admin" },
      {
        property: "og:description",
        content: "Manage member credit balances and review the full ledger for your shop.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminWallets,
});

interface Member {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  status: string;
  role: string;
  balance: number;
  points: number;
  commission: number;
  discount: number;
}

function AdminWallets() {
  const { ecosystemDbId } = useSession("admin");
  const [members, setMembers] = useState<Member[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState<Member | null>(null);
  const [editingMember, setEditingMember] = useState<EditableMember | null>(null);

  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [ledger, setLedger] = useState<CreditEntry[]>([]);
  const [mode, setMode] = useState<"credits" | "points">("credits");
  const [reversal, setReversal] = useState<ReversalInfo | null>(null);
  const [reversalAmount, setReversalAmount] = useState("");
  const [reversalReason, setReversalReason] = useState<string>(REVERSAL_REASONS[0]);
  const [reversalNote, setReversalNote] = useState("");
  const [reversals, setReversals] = useState<ReversalRecord[]>([]);
  const [reversing, setReversing] = useState(false);
  const load = useCallback(async () => {
    if (!ecosystemDbId) return;
    setLoading(true);
    const [{ data: profiles }, { data: roles }, { data: accounts }, { data: pointAccounts }, { data: entries }] =
      await Promise.all([
        supabase
          .from("profiles")
          .select("id, full_name, email, phone, status, reseller_commission_percent, reseller_discount_percent")
          .eq("ecosystem_id", ecosystemDbId),
        supabase.from("user_roles").select("user_id, role").eq("ecosystem_id", ecosystemDbId),
        supabase.from("credit_accounts").select("user_id, balance").eq("ecosystem_id", ecosystemDbId),
        supabase.from("points_accounts").select("user_id, balance").eq("ecosystem_id", ecosystemDbId),
        supabase
          .from("credit_ledger")
          .select(LEDGER_COLUMNS)
          .eq("ecosystem_id", ecosystemDbId)
          .order("created_at", { ascending: false })
          .limit(60),
      ]);
    const roleBy = new Map((roles ?? []).map((r) => [r.user_id, r.role as string]));
    const balBy = new Map((accounts ?? []).map((a) => [a.user_id, Number(a.balance)]));
    const ptsBy = new Map((pointAccounts ?? []).map((a) => [a.user_id, Number(a.balance)]));
    setMembers(
      (profiles ?? [])
        .map((p) => ({
          ...p,
          role: roleBy.get(p.id) ?? "customer",
          balance: balBy.get(p.id) ?? 0,
          points: ptsBy.get(p.id) ?? 0,
          // null = no personal override; the shop default is resolved server-side.
          commission: Number(p.reseller_commission_percent ?? 0),
          discount: Number(p.reseller_discount_percent ?? 0),
        }))
        .filter((m) => m.role !== "admin" && m.role !== "super_admin")
        .sort((a, b) => a.full_name.localeCompare(b.full_name)),
    );
    setLedger(
      ((entries ?? []) as unknown as CreditEntry[]).map(normalizeEntry),
    );
    setReversals(await fetchReversalHistory(ecosystemDbId));
    setLoading(false);
  }, [ecosystemDbId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!ecosystemDbId) return null;

  // Shared matcher: case-insensitive partial name/email match plus
  // formatting-insensitive phone match.
  const filtered = members.filter((m) => memberMatches(m, query));


  const nameFor = (id: string) => members.find((m) => m.id === id)?.full_name ?? id.slice(0, 8);

  const submit = async () => {
    if (!target) return;
    const value = Number(amount);
    if (!value) {
      toast.error("Enter an amount");
      return;
    }
    if (!reason.trim()) {
      toast.error("A reason is required");
      return;
    }
    setBusy(true);
    try {
      const tx =
        mode === "points"
          ? await adminAdjustPoints({
              userId: target.id,
              amount: Math.trunc(value),
              reason,
              ...(reference ? { reference } : {}),
            })
          : await adminAdjustCredits({
              userId: target.id,
              amount: value,
              reason,
              reference,
            });
      toast.success(mode === "points" ? "Points updated" : "Wallet updated", {
        description: `${value > 0 ? "+" : "−"}${
          mode === "points" ? `${Math.abs(Math.trunc(value))} pts` : peso(Math.abs(value))
        } · ${target.full_name} · ${tx}`,
      });
      setTarget(null);
      setAmount("");
      setReason("");
      setReference("");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const openReversal = async (e: CreditEntry) => {
    if (!e.tx_id) return;
    try {
      const info = await fetchReversalInfo(e.tx_id);
      if (!info.eligible) {
        toast.error(info.message ?? "This transfer cannot be reversed");
        if (info.code !== "ok") return;
      }
      setReversal(info);
      setReversalAmount(String(Math.min(info.amount ?? 0, info.available ?? 0)));
      setReversalReason(REVERSAL_REASONS[0]);
      setReversalNote("");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const submitReversal = async () => {
    if (!reversal?.tx_id) return;
    const check = validateReversalAmount({
      amount: Number(reversalAmount),
      original: reversal.amount ?? 0,
      available: reversal.available ?? 0,
    });
    if (!check.ok) {
      toast.error(check.error ?? "Invalid amount");
      return;
    }
    setReversing(true);
    try {
      const res = await reverseCreditTransfer({
        txId: reversal.tx_id,
        amount: Number(reversalAmount),
        reason: reversalReason,
        ...(reversalNote.trim() ? { note: reversalNote.trim() } : {}),
      });
      toast.success(res.kind === "full" ? "Transfer reversed" : "Transfer partially reversed", {
        description: `${peso(res.amount)} returned to ${reversal.sender_name} · ${res.reversal_tx_id}`,
      });
      setReversal(null);
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setReversing(false);
    }
  };

  const amountCheck = reversal
    ? validateReversalAmount({
        amount: Number(reversalAmount),
        original: reversal.amount ?? 0,
        available: reversal.available ?? 0,
      })
    : null;

  return (
    <>
      <PageSection
        title="Wallet management"
        description="Add or correct credits for customers and resellers. Every adjustment is audited."
      >
        <div className="mb-3 flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, email or mobile"
            />
          </div>
        </div>

        {loading ? (
          <EmptyState title="Loading wallets…" />
        ) : filtered.length === 0 ? (
          <EmptyState title="No members found" />
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {filtered.map((m) => (
              <Card key={m.id} className="min-w-0 shadow-[var(--shadow-card)]">
                <CardContent className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{m.full_name}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {m.email} · {m.phone || "no mobile"}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <StatusBadge
                        tone={
                          m.role === "reseller" ? "brand" : m.role === "subreseller" ? "success" : "muted"
                        }
                      >
                        {m.role === "reseller" || m.role === "subreseller"
                          ? `${m.role} · ${m.discount}% off`
                          : m.role}
                      </StatusBadge>
                      <StatusBadge tone={m.status === "active" ? "success" : "danger"}>
                        {m.status}
                      </StatusBadge>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-lg font-semibold text-success">{peso(m.balance)}</p>
                    <p className="text-[11px] text-points">{m.points} pts</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setMode("credits");
                          setTarget(m);
                        }}
                      >
                        <Wallet className="size-4" /> Credits
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setMode("points");
                          setTarget(m);
                        }}
                      >
                        Points
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingMember(m)}>
                        <UserCog className="size-4" /> Details
                      </Button>

                    </div>
                  </div>

                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </PageSection>

      <PageSection
        title="Ecosystem credit ledger"
        description="Latest 60 movements across all wallets. Transfers move exact amounts; sale earnings appear as their own entries."
      >
        <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard
            label="Credits released"
            value={peso(
              ledger
                .filter((e) => e.direction === "debit")
                .reduce((s, e) => s + Number(e.base_amount ?? e.amount), 0),
            )}
            hint="Debited from admin wallets"
          />
          <StatCard
            label="Sale earnings paid"
            value={peso(
              ledger
                .filter(
                  (e) =>
                    e.entry_kind === "sale_commission" || e.entry_kind === "upline_commission",
                )
                .reduce((s, e) => s + Number(e.amount ?? 0), 0),
            )}
            tone="positive"
            hint="Cashback and upline on voucher sales"
          />
          <StatCard
            label="Total received by members"
            value={peso(
              ledger.filter((e) => e.direction === "credit").reduce((s, e) => s + e.amount, 0),
            )}
            tone="brand"
          />
        </div>
        {ledger.length === 0 ? (
          <EmptyState title="No credit movements yet" />
        ) : (
          <Card className="min-w-0 shadow-[var(--shadow-card)]">
            <CardContent className="divide-y divide-border px-0 py-0">
              {ledger.map((e) => (
                <div key={e.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {nameFor(e.user_id)} · {e.reason}
                    </p>
                    {commissionBreakdown(e) ? (
                      <p className="text-[11px] font-medium text-success">{commissionBreakdown(e)}</p>
                    ) : null}
                    <p className="text-[11px] text-muted-foreground">
                      {shortDateTime(e.created_at)} · {e.tx_id ?? "—"}
                      {e.reference ? ` · ${e.reference}` : ""}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p
                      className={
                        e.direction === "credit"
                          ? "text-sm font-semibold text-success"
                          : "text-sm font-semibold text-destructive"
                      }
                    >
                      {e.direction === "credit" ? "+" : "−"}
                      {peso(e.amount)}
                    </p>
                    <p className="text-[11px] text-muted-foreground">Bal {peso(e.balance_after)}</p>
                    {isReversibleTransferEntry(e) ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="mt-1 h-7 px-2 text-[11px]"
                        onClick={() => void openReversal(e)}
                      >
                        <RotateCcw className="size-3.5" /> Reverse
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </PageSection>

      <PageSection
        title="Transfer reversals"
        description="Dispute corrections. Original transfers are never edited — each reversal is a linked ledger entry."
      >
        {reversals.length === 0 ? (
          <EmptyState title="No reversals recorded" />
        ) : (
          <Card className="min-w-0 shadow-[var(--shadow-card)]">
            <CardContent className="divide-y divide-border px-0 py-0">
              {reversals.map((r) => (
                <div key={r.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {nameFor(r.recipient_id)} → {nameFor(r.sender_id)}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {r.reason}
                      {r.note ? ` · ${r.note}` : ""} · by {r.actor_name}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {shortDateTime(r.created_at)} · original {r.original_tx_id} · reversal{" "}
                      {r.reversal_tx_id}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <StatusBadge tone={r.kind === "full" ? "danger" : "brand"}>
                      {r.kind === "full" ? "Full reversal" : "Partial reversal"}
                    </StatusBadge>
                    <p className="mt-1 text-sm font-semibold text-destructive">
                      −{peso(r.reversed_amount)}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      of {peso(r.original_amount)}
                    </p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </PageSection>

      <Dialog open={!!reversal} onOpenChange={(o) => !o && setReversal(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reverse credit transfer</DialogTitle>
            <DialogDescription>
              This creates a linked correction entry. The original transaction stays in the ledger
              exactly as it is.
            </DialogDescription>
          </DialogHeader>
          {reversal ? (
            <div className="space-y-3">
              <div className="space-y-1 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs">
                <p>
                  <span className="text-muted-foreground">Transaction</span> {reversal.tx_id}
                </p>
                <p>
                  <span className="text-muted-foreground">Sender</span> {reversal.sender_name}
                </p>
                <p>
                  <span className="text-muted-foreground">Recipient</span> {reversal.recipient_name}
                </p>
                <p>
                  <span className="text-muted-foreground">Amount</span> {peso(reversal.amount ?? 0)}{" "}
                  · {shortDateTime(reversal.created_at ?? new Date().toISOString())}
                </p>
                <p>
                  <span className="text-muted-foreground">Recipient balance</span>{" "}
                  {peso(reversal.recipient_balance ?? 0)}
                </p>
                <p>
                  <span className="text-muted-foreground">Reversible now</span>{" "}
                  {peso(reversal.available ?? 0)}
                </p>
              </div>

              {(reversal.available ?? 0) < (reversal.amount ?? 0) ? (
                <div className="flex gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <span>
                    Cannot reverse automatically because some credits have already been spent or
                    transferred. Only {peso(reversal.available ?? 0)} can be reversed as a partial
                    reversal. Voucher sales, points and commissions are never clawed back here — use
                    the sale refund workflow for a purchase dispute.
                  </span>
                </div>
              ) : null}

              <div className="space-y-1.5">
                <Label htmlFor="revamt">Amount to reverse</Label>
                <Input
                  id="revamt"
                  type="number"
                  inputMode="decimal"
                  value={reversalAmount}
                  onChange={(e) => setReversalAmount(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  {amountCheck?.ok
                    ? amountCheck.kind === "full"
                      ? "Full reversal of the original transfer."
                      : "Partial reversal — the rest stays with the recipient."
                    : (amountCheck?.error ?? "")}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="revreason">Dispute reason</Label>
                <select
                  id="revreason"
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={reversalReason}
                  onChange={(e) => setReversalReason(e.target.value)}
                >
                  {REVERSAL_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="revnote">Note (optional)</Label>
                <Input
                  id="revnote"
                  value={reversalNote}
                  onChange={(e) => setReversalNote(e.target.value)}
                  placeholder="Ticket or case reference"
                />
              </div>

              <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
                This cannot be undone automatically. To correct a mistaken reversal you must send a
                new credit transfer. A transfer can only be reversed once. No commission, cashback,
                points or earnings are generated.
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReversal(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={reversing || !amountCheck?.ok}
              onClick={() => void submitReversal()}
            >
              {reversing
                ? "Reversing…"
                : amountCheck?.kind === "partial"
                  ? "Confirm partial reversal"
                  : "Confirm full reversal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{mode === "points" ? "Adjust points" : "Adjust credits"}</DialogTitle>
            <DialogDescription>
              {target?.full_name} ·{" "}
              {mode === "points"
                ? `${target?.points ?? 0} pts`
                : `current balance ${peso(target?.balance ?? 0)}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="wamt">Amount (negative to deduct)</Label>
              <Input
                id="wamt"
                type="number"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
              />
            </div>
            {mode === "credits" ? (
              <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                Transfers carry no commission: {target?.full_name} receives exactly{" "}
                {peso(Math.max(Number(amount) || 0, 0))}. Members earn from their wholesale voucher
                discount and from sales commission when their credits are spent.
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="wreason">Reason</Label>
              <Input
                id="wreason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Cash top-up at counter"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wref">Reference (optional)</Label>
              <Input
                id="wref"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Receipt no."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} disabled={busy}>
              {busy ? "Saving…" : "Apply adjustment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <EditMemberDialog
        member={editingMember}
        onClose={() => setEditingMember(null)}
        onSaved={() => void load()}
      />
    </>
  );
}
