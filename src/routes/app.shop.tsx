import { createFileRoute } from "@tanstack/react-router";
import { Sparkles, Ticket } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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
import { EmptyState, PageSection, StatusBadge } from "@/components/ui-kit";
import { RatingStars } from "@/components/rating-stars";
import { soldLabel } from "@/lib/ratings";
import { useSession } from "@/lib/session";
import { peso } from "@/lib/wavewallet";
import {
  fetchCreditBalance,
  fetchShopProducts,
  listPrice,
  voucherCost,
  purchaseVoucher,
  type ShopProduct,
} from "@/lib/wallet";
import {
  fetchPointsAccount,
  fetchPointsRule,
  purchaseVoucherWithPoints,
  type PointsAccount,
} from "@/lib/rewards";
import { toast } from "sonner";

export const Route = createFileRoute("/app/shop")({
  head: () => ({
    meta: [
      { title: "Voucher Shop — WaveWallet" },
      {
        name: "description",
        content:
          "Buy WiFi vouchers with your shop credits or points. One unused code is issued per purchase and marked sold instantly.",
      },
      { property: "og:title", content: "Voucher Shop — WaveWallet" },
      {
        property: "og:description",
        content: "Buy WiFi vouchers with credits or points — codes are issued atomically and never reused.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CustomerShop,
});

type Method = "credits" | "points";

export function VoucherShopView({
  role,
  discountPercent = 0,
}: {
  role: "customer" | "reseller" | "subreseller" | "admin";
  discountPercent?: number;
}) {
  // Subresellers share the reseller workspace; the database still authorizes each purchase.
  const { account, ecosystemDbId } = useSession(role === "subreseller" ? "reseller" : role);
  const [products, setProducts] = useState<ShopProduct[]>([]);
  const [balance, setBalance] = useState(0);
  const [points, setPoints] = useState<PointsAccount>({ balance: 0, held: 0, available: 0 });
  const [ratio, setRatio] = useState(10);
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState<{ product: ShopProduct; method: Method } | null>(null);
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<{
    codes: string[];
    tx: string;
    name: string;
    price: string;
    earned: number;
  } | null>(null);
  const userId = account?.id ?? null;

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const [p, b, pts, r] = await Promise.all([
        fetchShopProducts(),
        fetchCreditBalance(userId, ecosystemDbId),
        fetchPointsAccount(userId, ecosystemDbId),
        ecosystemDbId ? fetchPointsRule(ecosystemDbId) : Promise.resolve(10),
      ]);
      setProducts(p);
      setBalance(b);
      setPoints(pts);
      setRatio(r);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [userId, ecosystemDbId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!account) return null;

  const priceFor = (p: ShopProduct) => voucherCost(listPrice(p), discountPercent);

  const openBuy = (product: ShopProduct, method: Method) => {
    setQty(1);
    setBuying({ product, method });
  };

  const maxQty = buying ? Math.min(50, Math.max(1, buying.product.available)) : 1;
  const unit = buying ? priceFor(buying.product) : 0;
  const total = Math.round(unit * qty * 100) / 100;

  const confirm = async () => {
    if (!buying) return;
    setBusy(true);
    try {
      if (buying.method === "points") {
        const res = await purchaseVoucherWithPoints(buying.product.id);
        setIssued({
          codes: [res.code],
          tx: res.tx_id,
          name: res.product_name,
          price: `${res.points_spent} pts`,
          earned: 0,
        });
      } else {
        const res = await purchaseVoucher(buying.product.id, qty);
        setIssued({
          codes: res.codes,
          tx: res.tx_id,
          name: `${res.product_name}${res.quantity > 1 ? ` ×${res.quantity}` : ""}`,
          price: peso(res.sale_price),
          earned: Number(res.points_earned ?? 0),
        });
      }
      setBuying(null);
      await load();
    } catch (e) {
      toast.error("Purchase failed", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };


  return (
    <>
      <PageSection
        title="Voucher shop"
        description={`Balance: ${peso(balance)} · ${points.available} pts available${
          discountPercent > 0
            ? ` · ${discountPercent}% ${
                role === "admin"
                  ? "admin voucher"
                  : role === "subreseller"
                    ? "subreseller"
                    : "reseller"
              } discount applied`
            : ""
        }`}
      >
        {loading ? (
          <EmptyState title="Loading products…" />
        ) : products.length === 0 ? (
          <EmptyState
            title="No vouchers on sale"
            description="Your shop admin has not published any active voucher products yet."
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {products.map((p) => {
              const price = priceFor(p);
              const soldOut = p.available === 0;
              const affordable = balance >= price;
              const pointsPrice = p.points_price ?? 0;
              const pointsOk = pointsPrice > 0 && points.available >= pointsPrice;
              return (
                <Card key={p.id} className="shadow-[var(--shadow-card)]">
                  <CardContent className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium">{p.name}</p>
                        <p className="text-xs text-muted-foreground">{p.description}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                          <RatingStars avg={p.rating_avg} count={p.rating_count} />
                          {soldLabel(p.sold_count) ? (
                            <span className="text-xs text-muted-foreground">
                              · {soldLabel(p.sold_count)}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <StatusBadge tone={soldOut ? "danger" : p.available <= 10 ? "warning" : "success"}>
                        {soldOut ? "Sold out" : `${p.available} left`}
                      </StatusBadge>
                    </div>
                    <div className="flex items-end gap-2">
                      <p className="text-xl font-semibold tracking-tight">{peso(price)}</p>
                      {p.promo_price !== null || discountPercent > 0 ? (
                        <p className="pb-1 text-xs text-muted-foreground line-through">
                          {peso(Number(p.credit_price))}
                        </p>
                      ) : null}
                      {pointsPrice > 0 ? (
                        <StatusBadge tone="points" className="mb-1 ml-auto">
                          or {pointsPrice} pts
                        </StatusBadge>
                      ) : null}
                    </div>
                    {discountPercent > 0 ? (
                      <p className="rounded-lg bg-success/10 px-2.5 py-1.5 text-[11px] font-medium text-success">
                        {role === "admin"
                          ? `Normal price ${peso(listPrice(p))} · admin discount ${discountPercent}% · your cost ${peso(price)}`
                          : `Your cost ${peso(price)} · sell at ${peso(listPrice(p))} · margin ${peso(listPrice(p) - price)} (${discountPercent}%)`}
                      </p>
                    ) : null}
                    <div className="grid gap-2">
                      <Button
                        className="w-full"
                        disabled={soldOut || !affordable}
                        onClick={() => openBuy(p, "credits")}
                      >
                        <Ticket className="size-4" />
                        {soldOut ? "Out of stock" : affordable ? "Buy with credits" : "Not enough credits"}
                      </Button>
                      {pointsPrice > 0 ? (
                        <Button
                          variant="outline"
                          className="w-full"
                          disabled={soldOut || !pointsOk}
                          onClick={() => openBuy(p, "points")}
                        >
                          <Sparkles className="size-4" />
                          {soldOut
                            ? "Out of stock"
                            : pointsOk
                              ? `Buy with ${pointsPrice} points`
                              : "Not enough points"}
                        </Button>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </PageSection>

      <Dialog open={!!buying} onOpenChange={(o) => !o && setBuying(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirm purchase</DialogTitle>
            <DialogDescription>
              {buying?.method === "credits"
                ? "Unused codes are assigned to you and marked sold immediately."
                : "One unused code will be assigned to you and marked sold immediately."}
            </DialogDescription>
          </DialogHeader>
          {buying ? (
            <div className="space-y-1 rounded-xl border border-border px-3 py-3 text-sm">
              <p className="flex justify-between">
                <span className="text-muted-foreground">Voucher</span>
                <span className="font-medium">{buying.product.name}</span>
              </p>
              {buying.method === "credits" ? (
                <>
                  <div className="flex items-center justify-between gap-2 py-1">
                    <span className="text-muted-foreground">Quantity</span>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        className="size-8"
                        disabled={qty <= 1}
                        onClick={() => setQty((q) => Math.max(1, q - 1))}
                        aria-label="Decrease quantity"
                      >
                        −
                      </Button>
                      <span className="w-8 text-center font-semibold tabular-nums">{qty}</span>
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        className="size-8"
                        disabled={qty >= maxQty}
                        onClick={() => setQty((q) => Math.min(maxQty, q + 1))}
                        aria-label="Increase quantity"
                      >
                        +
                      </Button>
                    </div>
                  </div>
                  <p className="flex justify-between">
                    <span className="text-muted-foreground">Unit price</span>
                    <span className="font-medium">{peso(unit)}</span>
                  </p>
                  <p className="flex justify-between">
                    <span className="text-muted-foreground">Total</span>
                    <span className="font-semibold text-destructive">−{peso(total)}</span>
                  </p>
                  <p className="flex justify-between">
                    <span className="text-muted-foreground">Balance after</span>
                    <span className="font-medium">{peso(balance - total)}</span>
                  </p>
                  <p className="flex justify-between">
                    <span className="text-muted-foreground">Points earned</span>
                    <span className="font-medium text-points">
                      +{ratio > 0 ? Math.floor(total / ratio) : 0}
                    </span>
                  </p>
                  {role === "customer" ? (
                    <p className="text-[11px] text-muted-foreground">
                      Whoever funded the credits you are spending earns their sales commission on
                      this purchase — your price is unaffected.
                    </p>
                  ) : null}
                </>
              ) : (
                <>
                  <p className="flex justify-between">
                    <span className="text-muted-foreground">Points</span>
                    <span className="font-semibold text-destructive">
                      −{buying.product.points_price} pts
                    </span>
                  </p>
                  <p className="flex justify-between">
                    <span className="text-muted-foreground">Points after</span>
                    <span className="font-medium">
                      {points.available - (buying.product.points_price ?? 0)} pts
                    </span>
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Points-funded purchases do not earn new points.
                  </p>
                </>
              )}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setBuying(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => void confirm()}
              disabled={busy || (buying?.method === "credits" && (total > balance || qty > maxQty))}
            >
              {busy ? "Issuing…" : "Confirm purchase"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!issued} onOpenChange={(o) => !o && setIssued(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{(issued?.codes.length ?? 0) > 1 ? "Vouchers issued" : "Voucher issued"}</DialogTitle>
            <DialogDescription>
              {issued?.name} · {issued?.price} · {issued?.tx}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-64 space-y-2 overflow-y-auto rounded-xl border border-success/40 bg-success-soft px-4 py-4 text-center">
            <p className="text-[11px] font-medium uppercase tracking-wide text-success">
              {(issued?.codes.length ?? 0) > 1 ? "Your codes" : "Your code"}
            </p>
            {issued?.codes.map((c) => (
              <p key={c} className="font-mono text-lg font-semibold tracking-widest text-success">
                {c}
              </p>
            ))}
          </div>
          {issued && issued.earned > 0 ? (
            <p className="text-center text-xs text-points">+{issued.earned} points earned</p>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                if (issued) void navigator.clipboard?.writeText(issued.codes.join("\n"));
                toast.success(issued && issued.codes.length > 1 ? "Codes copied" : "Code copied");
              }}
            >
              {issued && issued.codes.length > 1 ? "Copy codes" : "Copy code"}
            </Button>
            <Button onClick={() => setIssued(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </>
  );
}

function CustomerShop() {
  return <VoucherShopView role="customer" />;
}
