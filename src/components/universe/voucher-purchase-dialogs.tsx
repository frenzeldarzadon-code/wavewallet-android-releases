/**
 * Universe voucher purchase — the SAME step-by-step experience as the legacy
 * Voucher Shop (quantity stepper, total before confirming, optional voucher
 * details, then the issued-codes screen with Download / Share / Print).
 *
 * Only the entry point differs: the buyer arrives from a seller storefront, so
 * the purchase is attributed to that seller and paid from the global Universe
 * wallet through the existing `purchase_voucher` RPC. Nothing here prices,
 * issues or reprices a voucher — the database does all of that atomically, so
 * a cancelled or failed purchase consumes neither coins nor codes.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { IssuedVouchersDialog } from "@/components/voucher/issued-vouchers-dialog";
import type { PaymentStatus, VoucherImageData } from "@/lib/voucher-image";
import {
  commitQuantity,
  quantityFromInput,
  sanitizeQuantityInput,
} from "@/lib/voucher-quantity";
import { beginCriticalOperation } from "@/lib/app-update";
import { useOnline } from "@/lib/pwa";
import { peso } from "@/lib/wavewallet";
import { purchaseVoucher } from "@/lib/wallet";
import { fetchPointsAccount, purchaseVoucherWithPoints, type PointsAccount } from "@/lib/rewards";
import { pts } from "@/lib/points";
import type { StorefrontProduct } from "@/lib/seller-storefront";

export const MAX_QTY = 500;

/** Coins come from the global Universe wallet; points from the SELLING shop only. */
export type PurchaseMethod = "credits" | "points";

export interface PurchaseTarget {
  /** Owning/selling shop of the product — decides the points & rewards context. */
  shopId: string;
  shopName: string;
  product: StorefrontProduct;
  /** Authorized seller to attribute the sale to; null = direct shop purchase. */
  sellerId: string | null;
  sellerName: string | null;
  /** Signed-in buyer; used to read their points in the selling shop. */
  buyerId: string | null;
}

interface Issued {
  vouchers: VoucherImageData[];
  summary: string;
  earned: number;
  saleId: string | null;
}

const NO_POINTS: PointsAccount = { balance: 0, held: 0, available: 0 };

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
  const online = useOnline();
  const [qty, setQty] = useState(1);
  const [qtyText, setQtyText] = useState("1");
  const [customerName, setCustomerName] = useState("");
  const [payment, setPayment] = useState<PaymentStatus>(null);
  const [method, setMethod] = useState<PurchaseMethod>("credits");
  const [points, setPoints] = useState<PointsAccount | null>(null);
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [lastTargetKey, setLastTargetKey] = useState<string | null>(null);

  // Reset the form every time a different voucher is opened.
  const targetKey = target ? `${target.product.id}:${target.sellerId ?? ""}` : null;
  if (targetKey !== lastTargetKey) {
    setLastTargetKey(targetKey);
    setQty(1);
    setQtyText("1");
    setCustomerName("");
    setPayment(null);
    setMethod("credits");
  }

  // Points belong to the SELLING shop (never the seller, never the coin wallet).
  const pointsPrice = target?.product.pointsPrice ?? 0;
  const pointsOffered = pointsPrice > 0;
  const buyerId = target?.buyerId ?? null;
  const shopId = target?.shopId ?? null;
  useEffect(() => {
    if (!buyerId || !shopId || !pointsOffered) {
      setPoints(null);
      return;
    }
    let active = true;
    setPoints(null);
    void fetchPointsAccount(buyerId, shopId)
      .then((p) => active && setPoints(p))
      .catch(() => active && setPoints(NO_POINTS));
    return () => {
      active = false;
    };
  }, [buyerId, shopId, pointsOffered]);

  const usingPoints = method === "points" && pointsOffered;
  const maxQty = target ? Math.min(MAX_QTY, Math.max(1, target.product.available)) : 1;
  const unit = target?.product.price ?? 0;
  const total = Math.round(unit * qty * 100) / 100;
  const notEnough = balance !== null && total > balance;
  const pointsAvailable = points?.available ?? 0;
  const pointsOk = points !== null && pointsAvailable >= pointsPrice;
  const canConfirm = usingPoints ? pointsOk : !notEnough && qty <= maxQty;

  const confirm = async () => {
    if (!target) return;
    setBusy(true);
    const endCritical = beginCriticalOperation();
    try {
      const issuedAt = new Date();
      const name = customerName.trim();
      const voucher = (code: string, i: number, count: number, txId: string, productName: string) => ({
        code,
        productName,
        description: target.product.description ?? null,
        priceLabel: peso(unit),
        shopName: target.shopName,
        customerName: name || null,
        paymentStatus: payment,
        index: i + 1,
        total: count,
        txId,
        issuedAt,
      });
      if (usingPoints) {
        // Existing points flow: one voucher per purchase, no new points earned.
        const res = await purchaseVoucherWithPoints(target.product.id, target.sellerId);
        setIssued({
          vouchers: [voucher(res.code, 0, 1, res.tx_id, res.product_name)],
          summary: `${res.product_name} · ${res.points_spent} pts · ${res.tx_id}`,
          earned: 0,
          saleId: res.sale_id ?? null,
        });
      } else {
        const res = await purchaseVoucher(target.product.id, qty, target.sellerId);
        setIssued({
          vouchers: res.codes.map((code, i) =>
            voucher(code, i, res.codes.length, res.tx_id, res.product_name),
          ),
          summary: `${res.product_name}${res.quantity > 1 ? ` ×${res.quantity}` : ""} · ${peso(
            res.sale_price,
          )} · ${res.tx_id}`,
          earned: Number(res.points_earned ?? 0),
          saleId: res.sale_id ?? null,
        });
      }
      onClose();
      await onPurchased();
    } catch (e) {
      toast.error("Purchase failed", { description: (e as Error).message });
    } finally {
      endCritical();
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog open={Boolean(target)} onOpenChange={(o) => !o && !busy && onClose()}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirm purchase</DialogTitle>
            <DialogDescription>
              {target?.sellerName ? `Sold by ${target.sellerName} · ` : ""}
              {target?.shopName}. Paid from your Universe wallet — unused codes are assigned to
              you and marked sold only after you confirm.
            </DialogDescription>
          </DialogHeader>

          {target ? (
            <div className="space-y-1 rounded-xl border border-border px-3 py-3 text-sm">
              <p className="flex justify-between">
                <span className="text-muted-foreground">Voucher</span>
                <span className="font-medium">{target.product.name}</span>
              </p>
              {target.product.description ? (
                <p className="text-xs text-muted-foreground">{target.product.description}</p>
              ) : null}

              <div className="flex items-center justify-between gap-2 py-1">
                <span className="text-muted-foreground">Quantity</span>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="size-8"
                    disabled={qty <= 1}
                    onClick={() => {
                      const next = Math.max(1, qty - 1);
                      setQty(next);
                      setQtyText(String(next));
                    }}
                    aria-label="Decrease quantity"
                  >
                    −
                  </Button>
                  <Input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    aria-label="Quantity"
                    className="h-8 w-16 text-center font-semibold tabular-nums"
                    value={qtyText}
                    onChange={(e) => {
                      const digits = sanitizeQuantityInput(e.target.value);
                      const parsed = quantityFromInput(digits, maxQty);
                      setQtyText(parsed === null ? digits : String(parsed));
                      if (parsed !== null) setQty(parsed);
                    }}
                    onBlur={() => {
                      const next = commitQuantity(qtyText, maxQty);
                      setQty(next);
                      setQtyText(String(next));
                    }}
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="size-8"
                    disabled={qty >= maxQty}
                    onClick={() => {
                      const next = Math.min(maxQty, qty + 1);
                      setQty(next);
                      setQtyText(String(next));
                    }}
                    aria-label="Increase quantity"
                  >
                    +
                  </Button>
                </div>
              </div>
              <p className="text-right text-[11px] text-muted-foreground">
                Type any quantity from 1 to {maxQty}.
              </p>
              </>
              ) : null}

              {usingPoints ? (
                <>
                  <p className="flex justify-between">
                    <span className="text-muted-foreground">Points</span>
                    <span className="font-semibold text-destructive">−{pointsPrice} pts</span>
                  </p>
                  <p className="flex justify-between">
                    <span className="text-muted-foreground">{target.shopName} points</span>
                    <span className="font-medium">
                      {points === null ? "…" : pts(pointsAvailable)}
                    </span>
                  </p>
                  <p className="flex justify-between">
                    <span className="text-muted-foreground">Points after</span>
                    <span className={pointsOk ? "font-medium" : "font-medium text-destructive"}>
                      {points === null ? "…" : pts(pointsAvailable - pointsPrice)}
                    </span>
                  </p>
                  {points !== null && !pointsOk ? (
                    <p className="text-[11px] text-destructive">
                      Not enough {target.shopName} points. Points are earned in this shop when you
                      buy its vouchers with coins.
                    </p>
                  ) : null}
                  <p className="text-[11px] text-muted-foreground">
                    Points buy one voucher at a time and do not earn new points.
                  </p>
                </>
              ) : (
                <>
                  <p className="flex justify-between">
                    <span className="text-muted-foreground">Unit price</span>
                    <span className="font-medium">{peso(unit)}</span>
                  </p>
                  <p className="flex justify-between">
                    <span className="text-muted-foreground">Total</span>
                    <span className="font-semibold text-destructive">−{peso(total)}</span>
                  </p>
                  {balance !== null ? (
                    <>
                      <p className="flex justify-between">
                        <span className="text-muted-foreground">Universe wallet</span>
                        <span className="font-medium">{peso(balance)}</span>
                      </p>
                      <p className="flex justify-between">
                        <span className="text-muted-foreground">Balance after</span>
                        <span className={notEnough ? "font-medium text-destructive" : "font-medium"}>
                          {peso(balance - total)}
                        </span>
                      </p>
                    </>
                  ) : null}
                  {notEnough ? (
                    <p className="text-[11px] text-destructive">
                      Not enough coins in your Universe wallet.
                    </p>
                  ) : null}
                </>
              )}
            </div>
          ) : null}

          {/* Optional details printed on the voucher image only. They never
              change price, wallets, points, commissions or accounting. */}
          <div className="space-y-2 rounded-xl border border-dashed border-border px-3 py-3">
            <div className="space-y-1.5">
              <Label htmlFor="universe-voucher-customer">Customer name (optional)</Label>
              <Input
                id="universe-voucher-customer"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Printed on the voucher image"
                maxLength={60}
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Payment status (optional)</Label>
              <div className="grid grid-cols-3 gap-1.5">
                {([null, "paid", "credited"] as PaymentStatus[]).map((s) => (
                  <Button
                    key={s ?? "none"}
                    type="button"
                    size="sm"
                    variant={payment === s ? "default" : "outline"}
                    onClick={() => setPayment(s)}
                  >
                    <span className="truncate">
                      {s === null ? "None" : s === "paid" ? "Paid" : "Credited"}
                    </span>
                  </Button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                A note for your own record keeping only — it does not affect price, coins or
                commissions.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={busy || !online || !target || !canConfirm}
              onClick={() => void confirm()}
            >
              {busy
                ? "Issuing…"
                : usingPoints
                  ? pointsOk
                    ? `Confirm & pay ${pointsPrice} pts`
                    : "Not enough points"
                  : `Confirm & pay ${peso(total)}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <IssuedVouchersDialog
        vouchers={issued?.vouchers ?? []}
        summary={issued?.summary ?? ""}
        pointsEarned={issued?.earned ?? 0}
        saleId={issued?.saleId ?? null}
        historyTo="/universe/wallet"
        onClose={() => setIssued(null)}
      />
    </>
  );
}
