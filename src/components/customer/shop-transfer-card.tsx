/**
 * Move credits between two shops the member belongs to.
 *
 * The credits travel through the member's global (Universe) wallet, so the
 * money never leaves their own name. A flat platform fee is deducted from the
 * amount and the destination receives the remainder. Credits that arrive this
 * way earn NO cashback: any purchase they later fund pays the destination shop
 * admin the full retained share.
 */
import { useOnline } from "@/lib/pwa";
import { ArrowLeftRight, Info } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
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

const credits = (n: number) => `${n.toLocaleString()} coins`;

export function ShopTransferCard({
  onDone,
  embedded = false,
  sourceEcosystemId = null,
}: {
  onDone?: () => void;
  /** Rendered inside the Wallet Center "Send coins" card: no section/card chrome. */
  embedded?: boolean;
  /** The wallet currently selected in Wallet Center — used as the default source shop. */
  sourceEcosystemId?: string | null;
}) {
  const [wallets, setWallets] = useState<ShopWallet[]>([]);
  const [fee, setFee] = useState(DEFAULT_SHOP_TRANSFER_FEE);
  const [from, setFrom] = useState<string | null>(sourceEcosystemId);
  const [to, setTo] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const online = useOnline();
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [w, f] = await Promise.all([fetchMyShopWallets(), fetchShopTransferFee()]);
    setWallets(w);
    setFee(f);
    setFrom((cur) => cur ?? sourceEcosystemId ?? w[0]?.ecosystemId ?? null);
    setLoading(false);
  }, [sourceEcosystemId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Follow the wallet the member selected in Wallet Center.
  useEffect(() => {
    if (!sourceEcosystemId) return;
    setFrom(sourceEcosystemId);
    setTo((cur) => (cur === sourceEcosystemId ? null : cur));
  }, [sourceEcosystemId]);

  if (loading) return null;

  if (wallets.length < 2) {
    const explain = (
      <EmptyState
        title="Another approved shop is needed"
        description="Transfer Coins to Another Shop moves coins between two of your own shop wallets. You are currently an approved member of one shop only — join and get approved in a second shop from the Universe, and this transfer opens automatically."
      />
    );
    if (embedded) return explain;
    return (
      <PageSection devSlot="shop-transfer-card.transfer-coins-to-another-shop"
        title="Transfer Coins to Another Shop"
        description="Available once you are an approved member of more than one shop."
      >
        {explain}
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
      toast.success("Coins moved", {
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

  const Frame = ({ children }: { children: ReactNode }) =>
    embedded ? (
      <div className="space-y-4">
        <p className="text-sm font-semibold">Transfer Coins to Another Shop</p>
        <p className="text-xs text-muted-foreground">
          Move coins to your own wallet in another shop you are approved in. This is not Cash In
          or Cash Out — coins travel through your global Universe wallet and stay in your name.
        </p>
        {children}
      </div>
    ) : (
      <PageSection devSlot="shop-transfer-card.transfer-coins-to-another-shop-2"
        title="Transfer Coins to Another Shop"
        description="Move coins between two of your own shop wallets. Coins stay in your name; a flat platform fee applies."
      >
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="space-y-4">{children}</CardContent>
        </Card>
      </PageSection>
    );

  return (
    <>
      <Frame>
            <div className="space-y-1.5">
              <Label>From shop</Label>
              <Select {...(from ? { value: from } : {})} onValueChange={(v) => { setFrom(v); if (v === to) setTo(null); }}>
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
              <Select {...(to ? { value: to } : {})} onValueChange={(v) => setTo(v)}>
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
              <ArrowLeftRight className="size-4" /> Transfer Coins to Another Shop
            </Button>
      </Frame>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirm transfer to another shop</DialogTitle>
            <DialogDescription>
              Transferred coins earn no cashback and cannot be undone by you.
            </DialogDescription>
          </DialogHeader>
          <dl className="space-y-1.5 rounded-lg bg-muted/40 px-3 py-2 text-xs">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">From shop</dt>
              <dd className="truncate font-medium">{source?.ecosystemName ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">To shop</dt>
              <dd className="truncate font-medium">{destination?.ecosystemName ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Coins sent</dt>
              <dd className="font-medium">{credits(quote.amount)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Transfer fee</dt>
              <dd className="font-medium text-destructive">− {credits(quote.fee)}</dd>
            </div>
            <div className="flex justify-between gap-3 border-t border-border pt-1.5">
              <dt className="text-muted-foreground">Coins received</dt>
              <dd className="font-semibold text-success">{credits(quote.net)}</dd>
            </div>
          </dl>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button onClick={() => void send()} disabled={busy || !online}>
              {busy ? "Moving…" : "Move coins"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
