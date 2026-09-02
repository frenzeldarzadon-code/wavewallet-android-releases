import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui-kit";
import { peso } from "@/lib/wavewallet";
import { fetchCreditBalance, purchaseVoucher, type PurchaseResult } from "@/lib/wallet";
import {
  fetchSellerStorefront,
  type SellerStorefront,
  type StorefrontProduct,
  type StorefrontShop,
} from "@/lib/seller-storefront";

const MAX_QTY = 500;

/**
 * Public voucher storefront of one Universe seller. Buying here debits the
 * signed-in buyer's global Universe wallet and attributes the sale to this
 * seller; the database validates the seller's authorization on every purchase.
 */
export function SellerStorefrontSection({
  handle,
  viewerId,
}: {
  handle: string;
  /** Signed-in member id, or null for guests. */
  viewerId: string | null;
}) {
  const [store, setStore] = useState<SellerStorefront | null>(null);
  const [loading, setLoading] = useState(true);
  const [balance, setBalance] = useState<number | null>(null);
  const [buying, setBuying] = useState<{ shop: StorefrontShop; product: StorefrontProduct } | null>(null);
  const [qtyText, setQtyText] = useState("1");
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<PurchaseResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, b] = await Promise.all([
        fetchSellerStorefront(handle),
        viewerId ? fetchCreditBalance(viewerId, null).catch(() => null) : Promise.resolve(null),
      ]);
      setStore(s);
      setBalance(b);
    } catch (e) {
      toast.error("Could not load this storefront", { description: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, [handle, viewerId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <p className="text-sm text-muted-foreground">Loading vouchers…</p>;
  if (!store || store.shops.length === 0) return null;

  const qty = Math.min(MAX_QTY, Math.max(1, Number.parseInt(qtyText, 10) || 1));
  const total = buying ? Math.round(buying.product.price * qty * 100) / 100 : 0;
  const isSelf = viewerId !== null && viewerId === store.sellerId;
  const notEnough = balance !== null && total > balance;

  const confirm = async () => {
    if (!buying) return;
    setBusy(true);
    try {
      const res = await purchaseVoucher(buying.product.id, qty, isSelf ? null : store.sellerId);
      setIssued(res);
      setBuying(null);
      await load();
    } catch (e) {
      toast.error("Purchase failed", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-muted-foreground">Vouchers</h2>
        {viewerId && balance !== null ? (
          <p className="text-xs text-muted-foreground">
            Universe wallet: <span className="font-semibold text-foreground">{peso(balance)}</span>
          </p>
        ) : null}
      </div>
      {store.shops.map((shop) => (
        <Card key={shop.id} className="shadow-[var(--shadow-card)]">
          <CardContent className="space-y-3 py-4">
            <p className="text-sm font-medium">{shop.name}</p>
            {shop.products.length === 0 ? (
              <EmptyState title="No vouchers on sale" />
            ) : (
              <ul className="divide-y">
                {shop.products.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{p.name}</p>
                      {p.description ? (
                        <p className="truncate text-xs text-muted-foreground">{p.description}</p>
                      ) : null}
                      <p className="text-xs text-muted-foreground">
                        {peso(p.price)} · {p.available > 0 ? `${p.available} available` : "Out of stock"}
                      </p>
                    </div>
                    {viewerId ? (
                      <Button
                        size="sm"
                        disabled={p.available <= 0}
                        onClick={() => {
                          setQtyText("1");
                          setBuying({ shop, product: p });
                        }}
                      >
                        Buy
                      </Button>
                    ) : (
                      <Button asChild size="sm" variant="outline">
                        <a href="/?mode=signin">Sign in to buy</a>
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ))}

      <Dialog open={Boolean(buying)} onOpenChange={(o) => !o && !busy && setBuying(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Buy {buying?.product.name}</DialogTitle>
            <DialogDescription>
              Sold by {store.sellerName} · {buying?.shop.name}. Paid from your Universe wallet.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground" htmlFor="storefront-qty">
              Quantity (1–{Math.min(MAX_QTY, buying?.product.available ?? MAX_QTY)})
            </label>
            <Input
              id="storefront-qty"
              inputMode="numeric"
              value={qtyText}
              onChange={(e) => setQtyText(e.target.value.replace(/\D+/g, ""))}
              onBlur={() => setQtyText(String(qty))}
            />
            <p className="text-sm">
              Total: <span className="font-semibold">{peso(total)}</span>
              {balance !== null ? (
                <span className="text-muted-foreground"> · wallet {peso(balance)}</span>
              ) : null}
            </p>
            {notEnough ? (
              <p className="text-xs text-destructive">Not enough coins in your Universe wallet.</p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setBuying(null)}>
              Cancel
            </Button>
            <Button
              disabled={busy || notEnough || qty > (buying?.product.available ?? 0)}
              onClick={() => void confirm()}
            >
              {busy ? "Buying…" : "Confirm purchase"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(issued)} onOpenChange={(o) => !o && setIssued(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Voucher{(issued?.codes.length ?? 0) > 1 ? "s" : ""} issued</DialogTitle>
            <DialogDescription>
              {issued?.product_name} · {peso(issued?.sale_price ?? 0)} · {issued?.tx_id}
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-64 space-y-1 overflow-auto rounded-md bg-muted p-3 font-mono text-sm">
            {issued?.codes.map((c) => (
              <li key={c} className="select-all">
                {c}
              </li>
            ))}
          </ul>
          {issued && issued.points_earned > 0 ? (
            <p className="text-xs text-muted-foreground">
              You earned {issued.points_earned} points in the selling shop.
            </p>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                void navigator.clipboard?.writeText((issued?.codes ?? []).join("\n"));
                toast.success("Codes copied");
              }}
            >
              Copy codes
            </Button>
            <Button onClick={() => setIssued(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
