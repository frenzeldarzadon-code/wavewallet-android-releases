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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EcosystemSwitcher } from "@/components/ecosystem-switcher";
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
import { beginCriticalOperation } from "@/lib/app-update";
import { pts } from "@/lib/points";

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
  // Compact dropdown filters — no long vertical filter panel on mobile.
  const [sort, setSort] = useState<"name" | "price-asc" | "price-desc" | "popular">("name");
  const [avail, setAvail] = useState<"all" | "in" | "points">("all");
  const [buying, setBuying] = useState<{ product: ShopProduct; method: Method } | null>(null);
  const [qty, setQty] = useState(1);
  // The typed value, kept separate so the field may be briefly empty while the
  // buyer replaces "1" with e.g. "50". `qty` always stays a valid quantity.
  const [qtyText, setQtyText] = useState("1");
  const [customerName, setCustomerName] = useState("");
  const [payment, setPayment] = useState<PaymentStatus>(null);
  const [busy, setBusy] = useState(false);
  const online = useOnline();
  const [issued, setIssued] = useState<{
    vouchers: VoucherImageData[];
    summary: string;
    earned: number;
    saleId: string | null;
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
  const visible = useMemo(() => {
    let list = term
      ? products.filter(
          (p) =>
            p.name.toLowerCase().includes(term) ||
            (p.description ?? "").toLowerCase().includes(term),
        )
      : products.slice();
    if (avail === "in") list = list.filter((p) => p.available > 0);
    if (avail === "points") list = list.filter((p) => (p.points_price ?? 0) > 0);
    const retail = (p: ShopProduct) => listPrice(p);
    list.sort((a, b) => {
      if (sort === "price-asc") return retail(a) - retail(b);
      if (sort === "price-desc") return retail(b) - retail(a);
      if (sort === "popular") return (b.sold_count ?? 0) - (a.sold_count ?? 0);
      return a.name.localeCompare(b.name);
    });
    return list;
  }, [products, term, avail, sort]);

  if (!account) return null;

  /** Customer-facing retail price — the product's source of truth. */
  const retailFor = (p: ShopProduct) => listPrice(p);
  /** What THIS buyer is charged after their own discount (never the retail price). */
  const priceFor = (p: ShopProduct) => voucherCost(retailFor(p), discountPercent);

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
    // Suppresses background update checks/prompts while money is moving.
    const endCritical = beginCriticalOperation();
    try {
      // The voucher image always prints the shop's RETAIL price, never the
      // buyer's discounted acquisition cost. Charging is untouched.
      const retailLabel = peso(retailFor(buying.product));
      if (buying.method === "points") {
        const res = await purchaseVoucherWithPoints(buying.product.id);
        setIssued({
          vouchers: buildVouchers(
            [res.code],
            res.product_name,
            buying.product.description ?? null,
            retailLabel,
            res.tx_id,
          ),
          summary: `${res.product_name} · ${res.points_spent} pts · ${res.tx_id}`,
          earned: 0,
          saleId: res.sale_id ?? null,
        });
      } else {
        const res = await purchaseVoucher(buying.product.id, qty);
        setIssued({
          vouchers: buildVouchers(
            res.codes,
            res.product_name,
            buying.product.description ?? null,
            retailLabel,
            res.tx_id,
          ),
          summary: `${res.product_name}${res.quantity > 1 ? ` ×${res.quantity}` : ""} · ${peso(
            res.sale_price,
          )} · ${res.tx_id}`,
          earned: Number(res.points_earned ?? 0),
          saleId: res.sale_id ?? null,
        });
      }
      setBuying(null);
      await load();
    } catch (e) {
      toast.error("Purchase failed", { description: (e as Error).message });
    } finally {
      endCritical();
      setBusy(false);
    }
  };

  const discountLabel =
    role === "admin" ? "admin voucher" : role === "subreseller" ? "subreseller" : "reseller";


  return (
    <>
      {/* Premium futuristic hero — pure CSS gradients + a tiny CSS grid pattern,
          no raster art, so first paint stays fast on low-end phones. */}
      <section className="shop-hero relative overflow-hidden rounded-3xl px-4 py-5 text-primary-foreground shadow-[var(--shadow-float)] sm:px-6">
        <div className="shop-grid pointer-events-none absolute inset-0 opacity-60" aria-hidden />
        <div
          className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-[oklch(0.72_0.14_205_/_0.28)] blur-2xl"
          aria-hidden
        />
        <div className="relative space-y-4">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.22em] opacity-80">
                <Ticket className="size-3.5 shrink-0" aria-hidden /> Voucher shop
              </p>
              <h1 className="truncate text-2xl font-bold leading-tight sm:text-3xl">
                {ecosystem?.name ?? "WaveWallet"}
              </h1>
            </div>
            {/* Switch shop stays one tap away from the shop itself. */}
            <div className="shrink-0">
              <EcosystemSwitcher mini />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-2xl border border-background/15 bg-background/10 px-3 py-2 backdrop-blur-sm">
              <p className="flex items-center gap-1.5 text-[11px] opacity-85">
                <Wallet className="size-3.5" /> Coins
              </p>
              <p className="truncate text-lg font-bold tabular-nums text-[oklch(0.9_0.13_160)]">
                {peso(balance)}
              </p>
            </div>
            <div className="rounded-2xl border border-background/15 bg-background/10 px-3 py-2 backdrop-blur-sm">
              <p className="flex items-center gap-1.5 text-[11px] opacity-85">
                <Coins className="size-3.5" /> Points
              </p>
              <p className="truncate text-lg font-bold tabular-nums text-[oklch(0.88_0.14_85)]">
                {pts(points.available)}
              </p>
            </div>
          </div>

          {discountPercent > 0 ? (
            <p className="rounded-xl border border-background/15 bg-background/10 px-3 py-1.5 text-[11px] font-medium">
              {discountPercent}% {discountLabel} discount applies to what you pay — customers still
              pay the retail price shown on each card.
            </p>
          ) : null}

          <div className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
            <div className="relative min-w-0">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 opacity-70" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search vouchers"
                aria-label="Search vouchers"
                className="h-11 border-background/25 bg-background/15 pl-9 text-primary-foreground placeholder:text-primary-foreground/60"
              />
            </div>
            <div className="grid grid-cols-2 gap-2 sm:contents">
              <Select value={sort} onValueChange={(v) => setSort(v as typeof sort)}>
                <SelectTrigger
                  aria-label="Sort vouchers"
                  className="h-11 min-w-0 border-background/25 bg-background/15 text-primary-foreground"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="name">Name A–Z</SelectItem>
                  <SelectItem value="price-asc">Price: low to high</SelectItem>
                  <SelectItem value="price-desc">Price: high to low</SelectItem>
                  <SelectItem value="popular">Best selling</SelectItem>
                </SelectContent>
              </Select>
              <Select value={avail} onValueChange={(v) => setAvail(v as typeof avail)}>
                <SelectTrigger
                  aria-label="Filter vouchers"
                  className="h-11 min-w-0 border-background/25 bg-background/15 text-primary-foreground"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All vouchers</SelectItem>
                  <SelectItem value="in">In stock</SelectItem>
                  <SelectItem value="points">Points redeemable</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </section>


      <PageSection devSlot="shop.available-vouchers" title="Available vouchers" description="Codes come from your shop's uploaded inventory and are issued instantly.">
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
              const retail = retailFor(p);
              const price = priceFor(p);
              const discounted = price < retail;
              const soldOut = p.available === 0;
              const affordable = balance >= price;
              const pointsPrice = p.points_price ?? 0;
              const pointsOk = pointsPrice > 0 && points.available >= pointsPrice;
              return (
                <Card
                  key={p.id}
                  className={cn(
                    "card-sheen relative overflow-hidden rounded-2xl border-border/70 shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-float)]",
                    soldOut && "opacity-70",
                  )}
                >
                  <span
                    className={cn(
                      "absolute inset-y-0 left-0 w-1.5",
                      soldOut
                        ? "bg-destructive/70"
                        : pointsPrice > 0
                          ? "bg-points"
                          : "bg-primary",
                    )}
                    aria-hidden
                  />
                  <CardContent className="space-y-3 p-4 pl-5">
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

                    {/* RETAIL price is the headline everywhere. A buyer's own
                        discounted acquisition cost never replaces it. */}
                    <div className="flex flex-wrap items-end gap-x-2 gap-y-1 rounded-xl bg-gradient-to-r from-brand-soft to-transparent px-3 py-2">
                      <p className="price-glow text-2xl font-bold tracking-tight text-primary">
                        {peso(retail)}
                      </p>
                      <p className="pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        retail
                      </p>
                      {p.promo_price !== null ? (
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

                    {discounted ? (
                      <p className="rounded-lg bg-success/10 px-2.5 py-1.5 text-[11px] font-medium text-success">
                        {role === "admin"
                          ? `Your admin cost ${peso(price)} (${discountPercent}% off) · customers pay ${peso(retail)}`
                          : `Your cost ${peso(price)} · sell at ${peso(retail)} · margin ${peso(retail - price)} (${discountPercent}%)`}
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
              <p className="flex justify-between">
                <span className="text-muted-foreground">Retail price (printed on voucher)</span>
                <span className="font-medium text-primary">
                  {peso(retailFor(buying.product))}
                </span>
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
                      {pts(points.available - (buying.product.points_price ?? 0))}
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
        saleId={issued?.saleId ?? null}
        onClose={() => setIssued(null)}
      />


    </>
  );
}

function CustomerShop() {
  return <VoucherShopView role="customer" />;
}
