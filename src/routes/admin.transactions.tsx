import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, RotateCcw, Search, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, PageSection, StatusBadge } from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/lib/session";
import { fetchShopMembers } from "@/lib/shop-members";
import { peso, shortDateTime } from "@/lib/wavewallet";
import {
  canReverse,
  fetchTransactionFeed,
  filterFeed,
  TX_FILTERS,
  type TxFilter,
  type TxRow,
} from "@/lib/transaction-history";
import {
  fetchReversalInfo,
  REVERSAL_REASONS,
  reverseCreditTransfer,
  validateReversalAmount,
  type ReversalInfo,
} from "@/lib/transfer-reversal";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/transactions")({
  head: () => ({
    meta: [
      { title: "Transaction History — WaveWallet Admin" },
      {
        name: "description",
        content:
          "Every coin transfer, voucher sale, earning, adjustment and reversal in your shop, with a safe one-click reversal for eligible transfers.",
      },
      { property: "og:title", content: "Transaction History — WaveWallet Admin" },
      {
        property: "og:description",
        content:
          "Audit every financial movement in your shop and reverse disputed coin transfers safely.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminTransactions,
});

const KIND_TONE: Record<string, "brand" | "success" | "danger" | "muted"> = {
  transfer: "brand",
  purchase: "muted",
  earning: "success",
  adjustment: "muted",
  reversal: "danger",
};

function AdminTransactions() {
  const { ecosystemDbId } = useSession("admin");
  const [rows, setRows] = useState<TxRow[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<TxFilter>("all");
  const [query, setQuery] = useState("");
  const [reversal, setReversal] = useState<ReversalInfo | null>(null);
  const [reversalAmount, setReversalAmount] = useState("");
  const [reversalReason, setReversalReason] = useState<string>(REVERSAL_REASONS[0]);
  const [reversalNote, setReversalNote] = useState("");
  const [reversing, setReversing] = useState(false);

  const load = useCallback(async () => {
    if (!ecosystemDbId) return;
    setLoading(true);
    // Names come from shop membership so transactions of multi-shop members
    // are not shown as bare ids.
    const [roster, feed] = await Promise.all([
      fetchShopMembers(ecosystemDbId),
      fetchTransactionFeed(ecosystemDbId),
    ]);
    setNames(new Map(roster.map((m) => [m.id, m.full_name])));
    setRows(feed.rows);
    setLoading(false);
  }, [ecosystemDbId]);


  useEffect(() => {
    void load();
  }, [load]);

  const nameFor = useCallback(
    (id: string) => names.get(id) ?? id.slice(0, 8),
    [names],
  );

  const visible = useMemo(
    () => filterFeed(rows, filter, query, nameFor),
    [rows, filter, query, nameFor],
  );

  if (!ecosystemDbId) return null;

  const openReversal = async (row: TxRow) => {
    if (!row.txId) return;
    try {
      const info = await fetchReversalInfo(row.txId);
      setReversal(info);
      setReversalAmount(String(info.available ?? 0));
      setReversalReason(REVERSAL_REASONS[0]);
      setReversalNote("");
      if (!info.eligible) toast.error(info.message ?? "This transfer cannot be reversed");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  // `available` is what the database will still allow: the unreversed part of
  // the transfer capped by the untouched credits in the recipient's wallet.
  const amountCheck = reversal
    ? validateReversalAmount({
        amount: Number(reversalAmount),
        original: Math.max(
          0,
          (reversal.amount ?? 0) - (reversal.reversed_amount ?? 0),
        ),
        available: reversal.available ?? 0,
      })
    : null;


  const submitReversal = async () => {
    if (!reversal?.tx_id || !amountCheck?.ok) {
      toast.error(amountCheck?.error ?? "Invalid amount");
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
        description: `${peso(res.amount)} returned to ${reversal.sender_name ?? "the sender"} · ${res.reversal_tx_id}`,
      });
      setReversal(null);
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setReversing(false);
    }
  };

  return (
    <>
      <PageSection devSlot="transactions.transaction-history"
        title="Transaction history"
        description="Every financial movement in your shop — transfers, voucher sales, earnings, adjustments and reversals. Records older than 12 months are removed by the retention policy."
      >
        <div className="mb-3 flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search member, reason or transaction ID"
            />
          </div>
          <Select value={filter} onValueChange={(v) => setFilter(v as TxFilter)}>
            <SelectTrigger className="sm:w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TX_FILTERS.map((f) => (
                <SelectItem key={f.value} value={f.value}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <EmptyState title="Loading transactions…" />
        ) : visible.length === 0 ? (
          <EmptyState title="No transactions match this view" />
        ) : (
          <Card className="min-w-0 shadow-[var(--shadow-card)]">
            <CardContent className="divide-y divide-border px-0 py-0">
              {visible.map((r) => (
                <div key={r.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {nameFor(r.userId)} · {r.title}
                    </p>
                    {r.detail ? (
                      <p className="truncate text-[11px] text-muted-foreground">{r.detail}</p>
                    ) : null}
                    <p className="text-[11px] text-muted-foreground">
                      {shortDateTime(r.createdAt)} · {r.txId ?? "—"}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <StatusBadge tone={KIND_TONE[r.kind] ?? "muted"}>{r.kind}</StatusBadge>
                      {r.transfer && r.transfer.status !== "reversible" ? (
                        <StatusBadge tone="danger">
                          {r.transfer.status === "reversed"
                            ? "Reversed"
                            : `Partially reversed · ${peso(r.transfer.remaining)} left`}
                        </StatusBadge>
                      ) : null}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p
                      className={
                        r.direction === "credit"
                          ? "text-sm font-semibold text-success"
                          : "text-sm font-semibold text-destructive"
                      }
                    >
                      {r.direction === "credit" ? "+" : "−"}
                      {peso(r.amount)}
                    </p>
                    {r.balanceAfter !== null ? (
                      <p className="text-[11px] text-muted-foreground">
                        Bal {peso(r.balanceAfter)}
                      </p>
                    ) : null}
                    {canReverse(r) ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-1.5 h-8 border-destructive/40 px-2.5 text-[11px] font-medium text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => void openReversal(r)}
                      >
                        <RotateCcw className="size-3.5" />
                        {r.transfer && r.transfer.reversedAmount > 0
                          ? `Reverse ${peso(r.transfer.remaining)}`
                          : "Reverse"}
                      </Button>
                    ) : null}

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
            <DialogTitle>Reverse coin transfer</DialogTitle>
            <DialogDescription>
              The original transaction is never edited or deleted. A linked correction entry is
              created instead, and no commission, cashback or points are generated.
            </DialogDescription>
          </DialogHeader>
          {reversal ? (
            <div className="space-y-3">
              <div className="rounded-lg bg-muted px-3 py-2 text-xs">
                <p className="font-medium text-foreground">
                  {reversal.sender_name} → {reversal.recipient_name}
                </p>
                <p className="text-muted-foreground">
                  {peso(reversal.amount ?? 0)} on{" "}
                  {reversal.created_at ? shortDateTime(reversal.created_at) : "—"} ·{" "}
                  {reversal.tx_id}
                </p>
                <p className="mt-1 flex items-center gap-1.5 text-muted-foreground">
                  <ShieldCheck className="size-3.5" />
                  Reversible now: {peso(reversal.available ?? 0)}
                </p>
              </div>
              {!reversal.eligible ? (
                <p className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  {reversal.message ?? "This transfer cannot be reversed."}
                </p>
              ) : null}
              <div className="space-y-1.5">
                <Label htmlFor="revAmount">Amount to reverse (PHP)</Label>
                <Input
                  id="revAmount"
                  type="number"
                  value={reversalAmount}
                  onChange={(e) => setReversalAmount(e.target.value)}
                  disabled={!reversal.eligible}
                />
                {amountCheck && !amountCheck.ok ? (
                  <p className="text-[11px] text-destructive">{amountCheck.error}</p>
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    {amountCheck?.kind === "partial"
                      ? "Partial reversal — the rest of the transfer stays in place."
                      : "Full reversal of the original transfer."}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="revReason">Dispute reason</Label>
                <Select value={reversalReason} onValueChange={setReversalReason}>
                  <SelectTrigger id="revReason">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REVERSAL_REASONS.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="revNote">Note (optional)</Label>
                <Textarea
                  id="revNote"
                  rows={2}
                  value={reversalNote}
                  onChange={(e) => setReversalNote(e.target.value)}
                  placeholder="Reference, ticket number or extra context"
                />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReversal(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={reversing || !reversal?.eligible || !amountCheck?.ok}
              onClick={() => void submitReversal()}
            >
              {reversing ? "Reversing…" : "Confirm reversal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
