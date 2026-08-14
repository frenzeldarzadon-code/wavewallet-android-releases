/**
 * Credit transfer between members of the same shop.
 *
 * Unchanged financial behaviour: `transfer_credits` stays the single atomic
 * entry point and the database enforces who may receive credits. Only the
 * recipient lookup got richer (name / @handle / email / phone, nearest match).
 */
import { Info, Send } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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
import { EmptyState, PageSection } from "@/components/ui-kit";
import { MemberAvatar } from "@/components/member-avatar";
import { RecipientSearch } from "@/components/customer/recipient-search";
import { ShopTransferCard } from "@/components/customer/shop-transfer-card";
import { useSession } from "@/lib/session";
import { peso, shortDateTime } from "@/lib/wavewallet";
import { recipientIdentityLine } from "@/lib/recipient-search";
import {
  fetchCreditBalance,
  fetchCreditLedger,
  transferCredits,
  type CreditEntry,
  type RecipientMatch,
} from "@/lib/wallet";

export function TransferPage() {
  const { account, ecosystem } = useSession();
  const [selected, setSelected] = useState<RecipientMatch | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [balance, setBalance] = useState(0);
  const [entries, setEntries] = useState<CreditEntry[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const userId = account?.id ?? null;

  const load = useCallback(async () => {
    if (!userId) return;
    const [b, l] = await Promise.all([fetchCreditBalance(userId), fetchCreditLedger(userId, 50)]);
    setBalance(b);
    setEntries(l.filter((e) => e.reason.toLowerCase().includes("transfer")));
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!account || !ecosystem) return null;

  const value = Number(amount) || 0;
  const invalid = value <= 0 || value > balance || !selected;

  const send = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const tx = await transferCredits({ recipientId: selected.id, amount: value, note });
      toast.success("Transfer sent", {
        description: `${peso(value)} to ${selected.full_name} · ${tx}`,
      });
      setConfirming(false);
      setAmount("");
      setNote("");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageSection
        title="Send credits"
        description={`Transfers stay inside ${ecosystem.name}. Available: ${peso(balance)}`}
      >
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="space-y-4">
            <RecipientSearch selected={selected} onSelect={setSelected} />

            {selected ? (
              <div className="flex items-center gap-3 rounded-xl border border-primary bg-brand-soft px-3 py-2.5">
                <MemberAvatar path={selected.avatar_path ?? null} name={selected.full_name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{selected.full_name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {recipientIdentityLine(selected)}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
                  Change
                </Button>
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="amt">Amount</Label>
              <Input
                id="amt"
                type="number"
                inputMode="decimal"
                className="h-11"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
              />
              {value > balance ? (
                <p className="text-xs text-destructive">Amount exceeds your balance.</p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="note">Note (optional)</Label>
              <Input
                id="note"
                className="h-11"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Reference"
              />
            </div>

            <p className="flex items-start gap-2 rounded-lg bg-brand-soft px-3 py-2 text-xs text-accent-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              Transfers are atomic and appear in both histories with the same transaction ID. Credit
              transfers do not earn points and can never leave this shop.
            </p>

            <Button className="h-11 w-full" disabled={invalid} onClick={() => setConfirming(true)}>
              <Send className="size-4" /> Review transfer
            </Button>
          </CardContent>
        </Card>
      </PageSection>

      <ShopTransferCard onDone={() => void load()} />

      <PageSection title="Transfer history">
        {entries.length === 0 ? (
          <EmptyState title="No transfers yet" />
        ) : (
          <Card className="shadow-[var(--shadow-card)]">
            <CardContent className="divide-y divide-border px-0 py-0">
              {entries.map((e) => (
                <div key={e.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{e.reason}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {shortDateTime(e.created_at)} · {e.tx_id ?? "—"}
                    </p>
                  </div>
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
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </PageSection>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirm transfer</DialogTitle>
            <DialogDescription>
              {peso(value)} to {selected?.full_name}
              {selected?.handle ? ` (@${selected.handle})` : ""}. This cannot be undone by you.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Cancel
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
