/**
 * Move credits between two shops the member belongs to.
 *
 * The credits travel through the member's global (Universe) wallet, so the
 * money never leaves their own name. A flat platform fee is deducted from the
 * amount and the destination receives the remainder. Credits that arrive this
 * way earn NO cashback: any purchase they later fund pays the destination shop
 * admin the full retained share.
 */
import { ArrowLeftRight, Info } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState, PageSection } from "@/components/ui-kit";
import {
  destinationOptions,
  fetchMyShopWallets,
  fetchShopTransferFee,
  quoteShopTransfer,
  transferBetweenShops,
  validateShopTransfer,
  DEFAULT_SHOP_TRANSFER_FEE,
  type ShopWallet,
} from "@/lib/shop-transfers";

const credits = (n: number) => `${n.toLocaleString()} credits`;

export function ShopTransferCard({ onDone }: { onDone?: () => void }) {
  const [wallets, setWallets] = useState<ShopWallet[]>([]);
  const [fee, setFee] = useState(DEFAULT_SHOP_TRANSFER_FEE);
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [w, f] = await Promise.all([fetchMyShopWallets(), fetchShopTransferFee()]);
    setWallets(w);
    setFee(f);
    setFrom((cur) => cur ?? w[0]?.ecosystemId ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return null;

  if (wallets.length < 2) {
    return (
      <PageSection
        title="Move credits between your shops"
        description="Available once you are an approved member of more than one shop."
      >
        <EmptyState title="You belong to one shop" description="Join and get approved in another shop to move credits between them." />
      </PageSection>
    );
  }

  const source = wallets.find((w) => w.ecosystemId === from) ?? null;
  const destination = wallets.find((w) => w.ecosystemId === to) ?? null;
  const value = Number(amount) || 0;
  const quote = quoteShopTransfer(value, fee);
  const problem = validateShopTransfer({
    fromEcosystemId: from,
    toEcosystemId: to,
    amount: value,
    balance: source?.balance ?? 0,
    fee,
  });

  const send = async () => {
    if (!from || !to) return;
    setBusy(true);
    try {
      const res = await transferBetweenShops({
        fromEcosystemId: from,
        toEcosystemId: to,
        amount: value,
        note,
      });
      toast.success("Credits moved", {
        description: `${credits(res.net)} arrived in ${destination?.ecosystemName ?? "the destination shop"} · fee ${credits(res.fee)} · ${res.txId}`,
      });
      setConfirming(false);
      setAmount("");
      setNote("");
      await load();
      onDone?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageSection
        title="Move credits between your shops"
        description="Credits travel through your global Universe wallet and stay in your name."
      >
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>From shop</Label>
              <Select value={from ?? undefined} onValueChange={(v) => { setFrom(v); if (v === to) setTo(null); }}>
                <SelectTrigger className="h-11">
                  <SelectValue placeholder="Choose a shop" />
                </SelectTrigger>
                <SelectContent>
                  {wallets.map((w) => (
                    <SelectItem key={w.ecosystemId} value={w.ecosystemId}>
                      {w.ecosystemName} — {credits(w.balance)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>To shop</Label>
              <Select value={to ?? undefined} onValueChange={setTo}>
                <SelectTrigger className="h-11">
                  <SelectValue placeholder="Choose a shop" />
                </SelectTrigger>
                <SelectContent>
                  {destinationOptions(wallets, from).map((w) => (
                    <SelectItem key={w.ecosystemId} value={w.ecosystemId}>
                      {w.ecosystemName} — {credits(w.balance)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="shop-amt">Amount</Label>
              <Input
                id="shop-amt"
                type="number"
                inputMode="decimal"
                className="h-11"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
              />
              {source ? (
                <p className="text-xs text-muted-foreground">
                  Available in {source.ecosystemName}: {credits(source.balance)}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="shop-note">Note (optional)</Label>
              <Input
                id="shop-note"
                className="h-11"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Reference"
              />
            </div>

            <div className="rounded-lg bg-muted/40 px-3 py-2 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Transfer fee</span>
                <span className="font-medium">{credits(quote.fee)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Destination receives</span>
                <span className="font-semibold">{credits(quote.net)}</span>
              </div>
            </div>

            <p className="flex items-start gap-2 rounded-lg bg-brand-soft px-3 py-2 text-xs text-accent-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              A flat {credits(fee)} fee is deducted from every shop-to-shop transfer. Moving credits earns no
              cashback, and purchases funded by transferred credits pay 100% of the retained share to the
              destination shop admin — resellers and subresellers earn nothing on them.
            </p>

            {problem && value > 0 ? <p className="text-xs text-destructive">{problem}</p> : null}

            <Button className="h-11 w-full" disabled={!!problem} onClick={() => setConfirming(true)}>
              <ArrowLeftRight className="size-4" /> Review shop transfer
            </Button>
          </CardContent>
        </Card>
      </PageSection>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirm shop transfer</DialogTitle>
            <DialogDescription>
              {credits(quote.amount)} leaves {source?.ecosystemName}. After the {credits(quote.fee)} fee,{" "}
              {credits(quote.net)} arrives in {destination?.ecosystemName}. Transferred credits earn no cashback
              and cannot be undone by you.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button onClick={() => void send()} disabled={busy}>
              {busy ? "Moving…" : "Move credits"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
