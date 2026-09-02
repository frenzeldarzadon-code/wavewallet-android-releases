import { useState } from "react";
import { toast } from "sonner";
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
import { peso } from "@/lib/wavewallet";
import { purchaseVoucher, type PurchaseResult } from "@/lib/wallet";
import type { StorefrontProduct } from "@/lib/seller-storefront";

export const MAX_QTY = 500;

export interface PurchaseTarget {
  shopName: string;
  product: StorefrontProduct;
  /** Authorized seller to attribute the sale to; null = direct shop purchase. */
  sellerId: string | null;
  sellerName: string | null;
}

/**
 * The single Universe voucher purchase UI. Every path (seller storefront or
 * direct shop purchase) goes through the same Phase 1 `purchase_voucher`
 * engine: the global Universe wallet is debited and the database re-validates
 * the seller attribution on every call.
 */
export function VoucherPurchaseDialogs({
  target,
  balance,
  onClose,
  onPurchased,
}: {
  target: PurchaseTarget | null;
  balance: number | null;
  onClose: () => void;
  onPurchased: () => void | Promise<void>;
}) {
  const [qtyText, setQtyText] = useState("1");
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<PurchaseResult | null>(null);
  const [lastTargetKey, setLastTargetKey] = useState<string | null>(null);

  const targetKey = target ? `${target.product.id}:${target.sellerId ?? ""}` : null;
  if (targetKey !== lastTargetKey) {
    setLastTargetKey(targetKey);
    setQtyText("1");
  }

  const qty = Math.min(MAX_QTY, Math.max(1, Number.parseInt(qtyText, 10) || 1));
  const total = target ? Math.round(target.product.price * qty * 100) / 100 : 0;
  const notEnough = balance !== null && total > balance;

  const confirm = async () => {
    if (!target) return;
    setBusy(true);
    try {
      const res = await purchaseVoucher(target.product.id, qty, target.sellerId);
      setIssued(res);
      onClose();
      await onPurchased();
    } catch (e) {
      toast.error("Purchase failed", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog open={Boolean(target)} onOpenChange={(o) => !o && !busy && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Buy {target?.product.name}</DialogTitle>
            <DialogDescription>
              {target?.sellerName ? `Sold by ${target.sellerName} · ` : ""}
              {target?.shopName}. Paid from your Universe wallet.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground" htmlFor="storefront-qty">
              Quantity (1–{Math.min(MAX_QTY, target?.product.available ?? MAX_QTY)})
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
            <Button variant="outline" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={busy || notEnough || qty > (target?.product.available ?? 0)}
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
    </>
  );
}
