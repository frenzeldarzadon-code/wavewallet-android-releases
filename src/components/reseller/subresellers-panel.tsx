/**
 * Reseller-only management of their OWN subresellers: balances, read-only
 * credit history and direct wallet-to-wallet transfers.
 *
 * Nothing here is an authorization decision — the list, the history and the
 * transfer all go through RPCs that re-check ownership in the database.
 */
import { useCallback, useEffect, useState } from "react";
import { History, Send, Users } from "lucide-react";
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
import { EmptyState, PageSection, StatCard } from "@/components/ui-kit";
import { MemberAvatar } from "@/components/member-avatar";
import { peso, shortDate, shortDateTime } from "@/lib/wavewallet";
import {
  downlineTotals,
  fetchSubresellerLedger,
  listOwnSubresellers,
  validateSubresellerTransfer,
  type SubresellerLedgerEntry,
  type SubresellerRow,
} from "@/lib/subresellers";
import { transferCredits } from "@/lib/wallet";

export function SubresellersPanel({
  balance,
  onTransferred,
}: {
  /** The reseller's own shop wallet balance. */
  balance: number;
  onTransferred: () => void | Promise<void>;
}) {
  const [rows, setRows] = useState<SubresellerRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [historyFor, setHistoryFor] = useState<SubresellerRow | null>(null);
  const [entries, setEntries] = useState<SubresellerLedgerEntry[] | null>(null);
  const [transferFor, setTransferFor] = useState<SubresellerRow | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await listOwnSubresellers());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openHistory = async (row: SubresellerRow) => {
    setHistoryFor(row);
    setEntries(null);
    try {
      setEntries(await fetchSubresellerLedger(row.id, 100));
    } catch (e) {
      toast.error((e as Error).message);
      setEntries([]);
    }
  };

  const value = Number(amount) || 0;
  const problem = validateSubresellerTransfer({ target: transferFor, amount: value, balance });

  const send = async () => {
    if (!transferFor || problem) return;
    setBusy(true);
    try {
      const tx = await transferCredits({
        recipientId: transferFor.id,
        amount: value,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      toast.success("Credits transferred", {
        description: `${peso(value)} to ${transferFor.full_name} · ${tx}`,
      });
      setConfirming(false);
      setTransferFor(null);
      setAmount("");
      setNote("");
      await load();
      if (historyFor) await openHistory(historyFor);
      await onTransferred();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const totals = downlineTotals(rows ?? []);

  return (
    <>
      <PageSection
        title="Your subresellers"
        description="Only the subresellers you own. Transfers move credits from your wallet with no commission."
      >
        <div className="mb-3 grid grid-cols-2 gap-3">
          <StatCard label="Subresellers" value={String(totals.count)} hint={`${totals.active} active`} />
          <StatCard label="Their total balance" value={peso(totals.balance)} />
        </div>

        {error ? (
          <Card className="shadow-[var(--shadow-card)]">
            <CardContent className="py-4 text-sm text-destructive">{error}</CardContent>
          </Card>
        ) : rows === null ? (
          <Card className="shadow-[var(--shadow-card)]">
            <CardContent className="py-6 text-sm text-muted-foreground">Loading…</CardContent>
          </Card>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No subresellers yet"
            description="Members promoted to subreseller under you will appear here."
          />
        ) : (
          <div className="space-y-3">
            {rows.map((r) => (
              <Card key={r.id} className="shadow-[var(--shadow-card)]">
                <CardContent className="space-y-3 py-4">
                  <div className="flex items-start gap-3">
                    <MemberAvatar
                      name={r.full_name}
                      path={r.avatar_path}
                      className="size-10"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{r.full_name}</p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {r.masked_email} · {r.phone}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        Joined {shortDate(r.joined_at)} ·{" "}
                        <span className={r.status === "active" ? "text-success" : "text-destructive"}>
                          {r.status === "active" ? "Active" : "Suspended"}
                        </span>
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[11px] text-muted-foreground">Balance</p>
                      <p className="text-sm font-semibold">{peso(r.balance)}</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => void openHistory(r)}
                    >
                      <History className="size-4" /> View history
                    </Button>
                    <Button
                      size="sm"
                      className="flex-1"
                      disabled={r.status !== "active"}
                      onClick={() => {
                        setTransferFor(r);
                        setAmount("");
                        setNote("");
                      }}
                    >
                      <Send className="size-4" /> Transfer credits
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </PageSection>

      {/* Read-only history */}
      <Dialog open={!!historyFor} onOpenChange={(o) => !o && setHistoryFor(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Users className="size-4" /> {historyFor?.full_name}
            </DialogTitle>
            <DialogDescription>
              All credit movements in this shop, newest first. Read-only.
            </DialogDescription>
          </DialogHeader>
          {entries === null ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Loading history…</p>
          ) : entries.length === 0 ? (
            <EmptyState title="No transactions yet" />
          ) : (
            <div className="divide-y divide-border">
              {entries.map((e) => (
                <div key={e.id} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{e.reason}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {shortDateTime(e.created_at)} · {e.tx_id ?? "—"}
                      {e.reference ? ` · ${e.reference}` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p
                      className={`text-sm font-semibold ${
                        e.direction === "credit" ? "text-success" : "text-destructive"
                      }`}
                    >
                      {e.direction === "credit" ? "+" : "−"}
                      {peso(e.amount)}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Balance {peso(e.balance_after)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Transfer */}
      <Dialog
        open={!!transferFor && !confirming}
        onOpenChange={(o) => !o && setTransferFor(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Transfer to {transferFor?.full_name}</DialogTitle>
            <DialogDescription>
              Moves credits from your wallet to your subreseller. No commission is added.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="sub-amt">Amount</Label>
              <Input
                id="sub-amt"
                type="number"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sub-note">Note / reference (optional)</Label>
              <Input
                id="sub-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Float top-up…"
              />
            </div>
            <div className="space-y-1 rounded-xl border border-border px-3 py-3 text-sm">
              <p className="flex justify-between">
                <span className="text-muted-foreground">Your balance</span>
                <span className="font-medium">{peso(balance)}</span>
              </p>
              <p className="flex justify-between">
                <span className="text-muted-foreground">Your balance after</span>
                <span className="font-medium">{peso(Math.max(0, balance - value))}</span>
              </p>
            </div>
            {problem && value > 0 ? <p className="text-xs text-destructive">{problem}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferFor(null)}>
              Cancel
            </Button>
            <Button disabled={!!problem} onClick={() => setConfirming(true)}>
              Review transfer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirm transfer</DialogTitle>
            <DialogDescription>
              This debits your wallet and credits your subreseller in one step.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1 rounded-xl border border-border px-3 py-3 text-sm">
            <p className="flex justify-between">
              <span className="text-muted-foreground">Subreseller</span>
              <span className="font-medium">{transferFor?.full_name}</span>
            </p>
            <p className="flex justify-between">
              <span className="text-muted-foreground">Amount</span>
              <span className="font-semibold text-destructive">−{peso(value)}</span>
            </p>
            <p className="flex justify-between">
              <span className="text-muted-foreground">Your balance after</span>
              <span className="font-medium">{peso(Math.max(0, balance - value))}</span>
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={busy}>
              Back
            </Button>
            <Button onClick={() => void send()} disabled={busy}>
              {busy ? "Sending…" : "Send credits"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
