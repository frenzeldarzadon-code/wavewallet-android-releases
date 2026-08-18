import { useOnline } from "@/lib/pwa";
import { createFileRoute } from "@tanstack/react-router";
import { Coins, Search, Sparkles, Ticket, Wallet } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { EmptyState, PageSection, StatusBadge } from "@/components/ui-kit";
import { RatingStars } from "@/components/rating-stars";
import { IssuedVouchersDialog } from "@/components/voucher/issued-vouchers-dialog";
import type { PaymentStatus, VoucherImageData } from "@/lib/voucher-image";
import { soldLabel } from "@/lib/ratings";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
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
          "Buy WiFi vouchers with your shop coins or points. One unused code is issued per purchase and marked sold instantly.",
      },
      { property: "og:title", content: "Voucher Shop — WaveWallet" },
      {
        property: "og:description",
        content: "Buy WiFi vouchers with coins or points — codes are issued atomically and never reused.",
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
  const { account, ecosystem, ecosystemDbId } = useSession(
    role === "subreseller" ? "reseller" : role,
  );
  const [products, setProducts] = useState<ShopProduct[]>([]);
  const [balance, setBalance] = useState(0);
  const [points, setPoints] = useState<PointsAccount>({ balance: 0, held: 0, available: 0 });
  const [ratio, setRatio] = useState(10);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [buying, setBuying] = useState<{ product: ShopProduct; method: Method } | null>(null);
  const [qty, setQty] = useState(1);
  const [customerName, setCustomerName] = useState("");
  const [payment, setPayment] = useState<PaymentStatus>(null);
  const [busy, setBusy] = useState(false);
  const online = useOnline();
  const [issued, setIssued] = useState<{
    vouchers: VoucherImageData[];
    summary: string;
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

  const term = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      term
        ? products.filter(
            (p) =>
              p.name.toLowerCase().includes(term) ||
              (p.description ?? "").toLowerCase().includes(term),
          )
        : products,
    [products, term],
  );

  if (!account) return null;

  const priceFor = (p: ShopProduct) => voucherCost(listPrice(p), discountPercent);

  const openBuy = (product: ShopProduct, method: Method) => {
    setQty(1);
    setCustomerName("");
    setPayment(null);
    setBuying({ product, method });
  };

  const maxQty = buying ? Math.min(50, Math.max(1, buying.product.available)) : 1;
  const unit = buying ? priceFor(buying.product) : 0;
  const total = Math.round(unit * qty * 100) / 100;

  const buildVouchers = (
    codes: string[],
    productName: string,
    description: string | null,
    priceLabel: string,
    txId: string,
  ): VoucherImageData[] => {
    const issuedAt = new Date();
    const name = customerName.trim();
    return codes.map((code, i) => ({
      code,
      productName,
      description,
      priceLabel,
      shopName: ecosystem?.name ?? "WaveWallet",
      customerName: name || null,
      paymentStatus: payment,
      index: i + 1,
      total: codes.length,
      txId,
      issuedAt,
    }));
  };

  const confirm = async () => {
    if (!buying) return;
    setBusy(true);
    try {
      if (buying.method === "points") {
        const res = await purchaseVoucherWithPoints(buying.product.id);
        setIssued({
          vouchers: buildVouchers(
            [res.code],
            res.product_name,
            buying.product.description ?? null,
            `${res.points_spent} pts`,
            res.tx_id,
          ),
          summary: `${res.product_name} · ${res.points_spent} pts · ${res.tx_id}`,
          earned: 0,
        });
      } else {
        const res = await purchaseVoucher(buying.product.id, qty);
        const unitLabel = peso(Number(res.unit_price));
        setIssued({
          vouchers: buildVouchers(
            res.codes,
            res.product_name,
            buying.product.description ?? null,
            unitLabel,
            res.tx_id,
          ),
          summary: `${res.product_name}${res.quantity > 1 ? ` ×${res.quantity}` : ""} · ${peso(
            res.sale_price,
          )} · ${res.tx_id}`,
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

  const discountLabel =
    role === "admin" ? "admin voucher" : role === "subreseller" ? "subreseller" : "reseller";

  return (
    <>
      {/* Premium shop header: identity, balances and one clear search control. */}
      <section className="surface-gradient relative overflow-hidden rounded-2xl px-4 py-5 text-primary-foreground shadow-[var(--shadow-card)] sm:px-6">
        <div className="relative space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] opacity-80">
                Voucher shop
              </p>
              <h1 className="truncate text-xl font-semibold leading-tight sm:text-2xl">
                {ecosystem?.name ?? "WaveWallet"}
              </h1>
            </div>
            <Ticket className="size-7 shrink-0 opacity-80" aria-hidden />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-background/15 px-3 py-2">
              <p className="flex items-center gap-1.5 text-[11px] opacity-85">
                <Wallet className="size-3.5" /> Coins
              </p>
              <p className="truncate text-lg font-semibold tabular-nums">{peso(balance)}</p>
            </div>
            <div className="rounded-xl bg-background/15 px-3 py-2">
              <p className="flex items-center gap-1.5 text-[11px] opacity-85">
                <Coins className="size-3.5" /> Points
              </p>
              <p className="truncate text-lg font-semibold tabular-nums">
                {points.available} pts
              </p>
            </div>
          </div>

          {discountPercent > 0 ? (
            <p className="rounded-lg bg-background/15 px-3 py-1.5 text-[11px] font-medium">
              {discountPercent}% {discountLabel} discount applied to every price below.
            </p>
          ) : null}

          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 opacity-70" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search vouchers"
              aria-label="Search vouchers"
              className="h-11 border-background/25 bg-background/15 pl-9 text-primary-foreground placeholder:text-primary-foreground/60"
            />
          </div>
        </div>
      </section>

      <PageSection title="Available vouchers" description="Codes come from your shop's uploaded inventory and are issued instantly.">
        {loading ? (
          <EmptyState title="Loading products…" />
        ) : products.length === 0 ? (
          <EmptyState
            title="No vouchers on sale"
            description="Your shop admin has not published any active voucher products yet."
          />
        ) : visible.length === 0 ? (
          <EmptyState
            title="No match"
            description="No voucher in this shop matches your search."
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((p) => {
              const price = priceFor(p);
              const soldOut = p.available === 0;
              const affordable = balance >= price;
              const pointsPrice = p.points_price ?? 0;
              const pointsOk = pointsPrice > 0 && points.available >= pointsPrice;
              return (
                <Card
                  key={p.id}
                  className={cn(
                    "overflow-hidden border-border/70 shadow-[var(--shadow-card)] transition-shadow hover:shadow-lg",
                    soldOut && "opacity-70",
                  )}
                >
                  <CardContent className="space-y-3 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="break-words text-base font-semibold leading-snug">{p.name}</p>
                        {p.description ? (
                          <p className="mt-0.5 break-words text-xs text-muted-foreground">
                            {p.description}
                          </p>
                        ) : null}
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                          <RatingStars avg={p.rating_avg} count={p.rating_count} />
                          {soldLabel(p.sold_count) ? (
                            <span className="text-xs text-muted-foreground">
                              · {soldLabel(p.sold_count)}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <StatusBadge
                        tone={soldOut ? "danger" : p.available <= 10 ? "warning" : "success"}
                      >
                        {soldOut ? "Sold out" : `${p.available} left`}
                      </StatusBadge>
                    </div>

                    <div className="flex flex-wrap items-end gap-x-2 gap-y-1 rounded-xl bg-muted/60 px-3 py-2">
                      <p className="text-2xl font-bold tracking-tight">{peso(price)}</p>
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
                        size="lg"
                        className="w-full"
                        disabled={soldOut || !affordable}
                        onClick={() => openBuy(p, "credits")}
                      >
                        <Ticket className="size-4" />
                        <span className="truncate">
                          {soldOut
                            ? "Out of stock"
                            : affordable
                              ? "Buy with coins"
                              : "Not enough coins"}
                        </span>
                      </Button>
                      {pointsPrice > 0 ? (
                        <Button
                          variant="outline"
                          className="w-full"
                          disabled={soldOut || !pointsOk}
                          onClick={() => openBuy(p, "points")}
                        >
                          <Sparkles className="size-4" />
                          <span className="truncate">
                            {soldOut
                              ? "Out of stock"
                              : pointsOk
                                ? `Buy with ${pointsPrice} points`
                                : "Not enough points"}
                          </span>
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
                      Whoever funded the coins you are spending earns their sales commission on
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

          {/* Optional details printed on the voucher image only. They never
              change price, wallets, points, commissions or accounting. */}
          <div className="space-y-2 rounded-xl border border-dashed border-border px-3 py-3">
            <div className="space-y-1.5">
              <Label htmlFor="voucher-customer">Customer name (optional)</Label>
              <Input
                id="voucher-customer"
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
                A note for your own record keeping only — it does not affect funding, price,
                coins, points or commissions.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setBuying(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => void confirm()}
              disabled={busy || !online || (buying?.method === "credits" && (total > balance || qty > maxQty))}
            >
              {busy ? "Issuing…" : "Confirm & Generate Vouchers"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <IssuedVouchersDialog
        vouchers={issued?.vouchers ?? []}
        summary={issued?.summary ?? ""}
        pointsEarned={issued?.earned ?? 0}
        onClose={() => setIssued(null)}
      />


    </>
  );
}

function CustomerShop() {
  return <VoucherShopView role="customer" />;
}
