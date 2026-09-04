/**
 * Retail store of one shop.
 *
 * Visually a sibling of the voucher shop, but for physical goods: many
 * products and quantities go into one cart, and checkout asks for pickup or
 * delivery and the payment method the shop admin enabled. Credits are only
 * held when the order is placed and are returned in full if the admin rejects
 * it, so nothing is spent until an order is confirmed.
 *
 * Two entry points share this view:
 *  - `role`: the legacy shop console (`/app/store`, `/reseller/store`) scoped
 *    by the active membership;
 *  - `shop`: the Universe customer portal (`/universe/store/$slug`). Universe
 *    is the customer portal — no shop membership is needed to buy, and the
 *    coins come from the buyer's ONE global Universe Wallet.
 *
 * Self purchase: when the buyer is the entitled cashback recipient of their
 * own shop (an authorized reseller buying from their shop), the database nets
 * the cashback out of the single wallet hold. The checkout shows that server
 * quote — Retail Price, cashback, Actual Charge — before confirmation.
 */
import { Banknote, ClipboardList, Loader2, PackageCheck, ShoppingCart } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, PageSection } from "@/components/ui-kit";
import { RatingPicker } from "@/components/rating-stars";
import { RETAIL_VISIBLE } from "@/lib/features";
import { useSession } from "@/lib/session";
import { fetchCreditBalance } from "@/lib/wallet";
import { peso, shortDateTime } from "@/lib/wavewallet";
import {
  DEFAULT_STORE_SETTINGS,
  codCustomerTotal,
  countByCustomerStage,
  cartCount,
  cartLines,
  cartQuote,
  changeQuantity,
  checkoutProblem,
  fetchCheckoutQuote,
  fetchMyRetailOrders,
  fetchRetailFeePercent,
  fetchRetailProducts,
  netCharge,
  sellerToCustomer,
  fetchStoreSettings,
  placeRetailOrder,
  rateRetailProduct,
  type Cart,
  type CheckoutDraft,
  type CheckoutQuote,
  type CodQuote,
  type RetailOrder,
  type RetailProduct,
  type StoreSettings,
} from "@/lib/retail";
import { fetchCodQuote } from "@/lib/retail-cod";
import {
  CATALOG_PAGE_SIZE,
  DEFAULT_CATALOG_QUERY,
  applyCatalogQuery,
  catalogCategories,
  catalogQueryActive,
  useDebouncedValue,
  type CatalogQuery,
} from "@/lib/retail-catalog";
import {
  CartSheet,
  CatalogToolbar,
  CategoryTiles,
  MarketplaceEmpty,
  MarketplaceError,
  MarketplaceHeader,
  ProductCard,
  ProductDetailSheet,
  ProductGridSkeleton,
  productGridClass,
} from "@/components/retail/marketplace";
import { EcosystemSwitcher } from "@/components/ecosystem-switcher";
import { CustomerOrdersPanel } from "@/components/retail/customer-orders-panel";

const credits = (n: number) => `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} coins`;

/** A Universe shop opened from the customer portal (no membership required). */
export interface UniverseStoreTarget {
  id: string;
  name: string;
  description?: string | null;
  /** Product to open on arrival (deep link from a post or the public storefront). */
  productId?: string | null;
}

type RetailStoreViewProps =
  | { role: "customer" | "reseller"; shop?: undefined }
  | { role?: undefined; shop: UniverseStoreTarget };

export function RetailStoreView(props: RetailStoreViewProps) {
  const session = useSession(props.role);
  const account = session.account;
  const universeShop = props.shop ?? null;
  const ecosystemDbId = universeShop ? universeShop.id : session.ecosystemDbId;
  const shopName = universeShop ? universeShop.name : (session.ecosystem?.name ?? "Retail shop");
  const shopDescription = universeShop
    ? (universeShop.description ?? null)
    : (session.ecosystem?.description ?? null);
  const navigate = useNavigate();
  const [products, setProducts] = useState<RetailProduct[]>([]);
  const [settings, setSettings] = useState<StoreSettings>(DEFAULT_STORE_SETTINGS);
  const [orders, setOrders] = useState<RetailOrder[]>([]);
  const [balance, setBalance] = useState(0);
  const [feePercent, setFeePercent] = useState(0);
  const [cart, setCart] = useState<Cart>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [checkout, setCheckout] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(universeShop?.productId ?? null);
  const [catalogQuery, setCatalogQuery] = useState<CatalogQuery>(DEFAULT_CATALOG_QUERY);
  const [pageLimit, setPageLimit] = useState(CATALOG_PAGE_SIZE);
  const [busy, setBusy] = useState(false);
  const [checkoutRef, setCheckoutRef] = useState<string | null>(null);
  const [codQuote, setCodQuote] = useState<CodQuote | null>(null);
  // Server checkout quote: retail total / self-purchase cashback / actual charge.
  const [quoteInfo, setQuoteInfo] = useState<CheckoutQuote | null>(null);
  const [draft, setDraft] = useState<CheckoutDraft>({
    fulfillment: null,
    payment: null,
    address: "",
    notes: "",
  });
  const [rating, setRating] = useState<{
    order: RetailOrder;
    productId: string;
    value: number;
  } | null>(null);
  const userId = account?.id ?? null;
  const ordersRef = useRef<HTMLDivElement>(null);
  const activeOrders = useMemo(() => countByCustomerStage(orders).active, [orders]);
  const scrollToOrders = () =>
    ordersRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  // Notifications deep-link to the store with #orders — land on the history.
  useEffect(() => {
    if (!loading && typeof window !== "undefined" && window.location.hash === "#orders")
      scrollToOrders();
  }, [loading]);

  const load = useCallback(async () => {
    if (!ecosystemDbId || !userId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [p, s, o, b, f] = await Promise.all([
        fetchRetailProducts(ecosystemDbId),
        fetchStoreSettings(ecosystemDbId),
        fetchMyRetailOrders(ecosystemDbId),
        // Universe shops charge the buyer's single global Universe Wallet.
        fetchCreditBalance(userId, universeShop ? null : ecosystemDbId),
        fetchRetailFeePercent(),
      ]);
      setProducts(p);
      setSettings(s);
      setOrders(o);
      setBalance(b);
      setFeePercent(f);
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [ecosystemDbId, userId, universeShop]);

  useEffect(() => {
    void load();
  }, [load]);

  // Discovery runs over the shop's already-loaded catalog; the search box is
  // debounced so typing never re-filters on every keystroke.
  const debouncedSearch = useDebouncedValue(catalogQuery.search);
  const categories = useMemo(() => catalogCategories(products), [products]);
  const visibleProducts = useMemo(
    () => applyCatalogQuery(products, { ...catalogQuery, search: debouncedSearch }, feePercent),
    [products, catalogQuery, debouncedSearch, feePercent],
  );
  const filtersActive = catalogQueryActive(catalogQuery);
  useEffect(() => {
    setPageLimit(CATALOG_PAGE_SIZE);
  }, [debouncedSearch, catalogQuery.category, catalogQuery.sort, catalogQuery.inStockOnly]);

  const lines = cartLines(cart, products, feePercent);
  const quote = cartQuote(cart, products, feePercent);
  const total = quote.total;
  const count = cartCount(cart);

  // Server-side COD eligibility (seller-side ₱-fee coverage, split configured, shop offers it).
  // Re-quoted whenever the cart's seller total changes while checkout is open.
  useEffect(() => {
    if (!checkout || !ecosystemDbId || !settings.codEnabled || count === 0) {
      setCodQuote(null);
      return;
    }
    let live = true;
    setCodQuote(null);
    void fetchCodQuote(ecosystemDbId, quote.sellerTotal)
      .then((q) => live && setCodQuote(q))
      .catch(
        () =>
          live &&
          setCodQuote({
            available: false,
            reason: "Cash on delivery is not available right now",
            deliveryFee: 0,
            platformFee: 0,
            customerTotal: total,
          }),
      );
    return () => {
      live = false;
    };
  }, [checkout, ecosystemDbId, settings.codEnabled, quote.sellerTotal, count, total]);

  // Server checkout quote for coin orders: the database decides whether this is
  // a self purchase and how much cashback is netted out. Never client-computed.
  const cartKey = JSON.stringify(cart);
  useEffect(() => {
    if (!checkout || !ecosystemDbId || count === 0) {
      setQuoteInfo(null);
      return;
    }
    let live = true;
    void fetchCheckoutQuote(ecosystemDbId, cart, undefined, "credit")
      .then((q) => live && setQuoteInfo(q))
      .catch(() => live && setQuoteInfo(null));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkout, ecosystemDbId, cartKey, count]);

  if (!account || !ecosystemDbId) return null;

  const selfPurchase = !!quoteInfo?.selfPurchase && quoteInfo.selfCashback > 0;
  const charge = netCharge(total, quoteInfo);
  const problem = checkoutProblem(draft, total, settings, balance, count, codQuote, quoteInfo);
  const codDeliveryFee = codQuote?.deliveryFee ?? settings.deliveryFee;
  const codTotal = codCustomerTotal(total, codDeliveryFee);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // One ref per checkout attempt: a double tap or network retry replays the same order.
      const ref = checkoutRef ?? crypto.randomUUID();
      setCheckoutRef(ref);
      const placed = await placeRetailOrder(ecosystemDbId, cart, draft, undefined, ref);
      setCheckoutRef(null);
      toast.success(`Order ${placed.orderNo} sent for approval`, {
        description:
          draft.payment === "credit"
            ? `${peso(charge)} in coins is held until the shop admin approves or rejects.`
            : draft.payment === "cod"
              ? `Pay ${peso(codTotal)} in cash when it arrives. No coins are taken from your wallet.`
              : "Pay in cash — the shop admin confirms the order.",
      });
      setCart({});
      setCheckout(false);
      setDraft({ fulfillment: null, payment: null, address: "", notes: "" });
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!RETAIL_VISIBLE || !settings.retailEnabled) {
    return (
      <PageSection devSlot="retail-store-view.retail-store" title="Retail store">
        <EmptyState
          title="The retail store is not available"
          description="The shop admin has not enabled a retail store yet."
        />
      </PageSection>
    );
  }

  const detailProduct = detailId ? (products.find((p) => p.id === detailId) ?? null) : null;

  return (
    <>
      <MarketplaceHeader
        shopName={shopName}
        description={shopDescription}
        productCount={products.length}
        search={catalogQuery.search}
        onSearch={(search) => setCatalogQuery((q) => ({ ...q, search }))}
        cartCount={count}
        onOpenCart={() => setCartOpen(true)}
        aside={universeShop ? undefined : <EcosystemSwitcher mini />}
        logoPath={settings.logoPath}
        coverPath={settings.coverPath}
        acceptingOrders={settings.acceptingOrders}
        pausedNote={settings.pausedNote}
      />

      <div className="flex justify-end">
        <Button size="sm" variant="outline" className="rounded-full" onClick={scrollToOrders}>
          <ClipboardList className="size-4" /> My orders
          {activeOrders > 0 ? (
            <span className="rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground tabular-nums">
              {activeOrders} active
            </span>
          ) : null}
        </Button>
      </div>

      <section className="space-y-3" aria-label="Products">
        {loading ? (
          <ProductGridSkeleton />
        ) : loadError ? (
          <MarketplaceError message={loadError} onRetry={() => void load()} />
        ) : products.length === 0 ? (
          <MarketplaceEmpty filtered={false} />
        ) : (
          <>
            <CategoryTiles
              categories={categories}
              active={catalogQuery.category}
              total={products.length}
              onSelect={(category) => setCatalogQuery((q) => ({ ...q, category }))}
            />
            <CatalogToolbar
              query={catalogQuery}
              count={visibleProducts.length}
              active={filtersActive}
              onChange={setCatalogQuery}
              onReset={() => setCatalogQuery(DEFAULT_CATALOG_QUERY)}
            />
            {visibleProducts.length === 0 ? (
              <MarketplaceEmpty filtered onClear={() => setCatalogQuery(DEFAULT_CATALOG_QUERY)} />
            ) : (
              <>
                <div className={productGridClass}>
                  {visibleProducts.slice(0, pageLimit).map((p) => (
                    <ProductCard
                      key={p.id}
                      product={p}
                      feePercent={feePercent}
                      quantity={cart[p.id] ?? 0}
                      onOpen={() => setDetailId(p.id)}
                      onAdd={() => setCart(changeQuantity(cart, p, 1))}
                      onRemove={() => setCart(changeQuantity(cart, p, -1))}
                    />
                  ))}
                </div>
                {visibleProducts.length > pageLimit ? (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => setPageLimit((n) => n + CATALOG_PAGE_SIZE)}
                  >
                    Show more ({visibleProducts.length - pageLimit} left)
                  </Button>
                ) : null}
              </>
            )}
          </>
        )}
      </section>

      {count > 0 && !cartOpen && !checkout && !detailProduct ? (
        <div className="pointer-events-none sticky bottom-3 z-30 flex justify-center">
          <Button
            size="lg"
            className="pointer-events-auto rounded-full shadow-[var(--shadow-float)]"
            onClick={() => setCartOpen(true)}
          >
            <ShoppingCart className="size-4" /> {count} item{count === 1 ? "" : "s"} · {peso(total)}
          </Button>
        </div>
      ) : null}

      <ProductDetailSheet
        product={detailProduct}
        feePercent={feePercent}
        settings={settings}
        shopName={shopName}
        quantity={detailProduct ? (cart[detailProduct.id] ?? 0) : 0}
        onChange={(delta) => detailProduct && setCart(changeQuantity(cart, detailProduct, delta))}
        onClose={() => setDetailId(null)}
        onBuyNow={() => {
          setDetailId(null);
          setCheckout(true);
        }}
      />

      <CartSheet
        open={cartOpen}
        lines={lines}
        quote={quote}
        feePercent={feePercent}
        settings={settings}
        onChange={(p, delta) => setCart(changeQuantity(cart, p, delta))}
        onRemove={(p) => setCart(changeQuantity(cart, p, -(cart[p.id] ?? 0)))}
        onClose={() => setCartOpen(false)}
        onCheckout={() => {
          setCartOpen(false);
          setCheckout(true);
        }}
      />

      <div ref={ordersRef} className="scroll-mt-4">
        <CustomerOrdersPanel
          orders={orders}
          loading={loading}
          error={loadError}
          onRetry={() => void load()}
          onChanged={load}
          onChat={(thread) => void navigate({ to: "/universe/messages", search: { thread } })}
          onRate={(order, productId) => setRating({ order, productId, value: 5 })}
        />
      </div>

      <Dialog open={checkout} onOpenChange={(o) => !o && setCheckout(false)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Checkout</DialogTitle>
            <DialogDescription>
              {count} item(s) · total {credits(total)}
            </DialogDescription>
          </DialogHeader>

          <ul className="space-y-1 text-sm">
            {lines.map((l) => (
              <li key={l.product.id} className="flex justify-between gap-2">
                <span>
                  {l.quantity} × {l.product.name}
                  {l.wholesale ? (
                    <span className="ml-1 text-[11px] text-success">
                      wholesale {credits(sellerToCustomer(l.unitPrice, feePercent))} each
                      {" · "}
                      <s className="text-muted-foreground">
                        {credits(sellerToCustomer(l.product.price, feePercent))}
                      </s>
                    </span>
                  ) : null}
                </span>
                <span>{credits(l.lineTotal)}</span>
              </li>
            ))}
          </ul>
          {/* Retail Prices already include everything; the platform fee is never a customer line. */}

          <div className="space-y-2">
            <Label>How do you want it?</Label>
            <div className="flex gap-2">
              {settings.pickupEnabled ? (
                <Button
                  type="button"
                  variant={draft.fulfillment === "pickup" ? "default" : "outline"}
                  className="flex-1"
                  onClick={() => setDraft({ ...draft, fulfillment: "pickup" })}
                >
                  Pickup
                </Button>
              ) : null}
              {settings.deliveryEnabled ? (
                <Button
                  type="button"
                  variant={draft.fulfillment === "delivery" ? "default" : "outline"}
                  className="flex-1"
                  onClick={() => setDraft({ ...draft, fulfillment: "delivery" })}
                >
                  Door-to-door delivery
                </Button>
              ) : null}
            </div>
          </div>

          {draft.fulfillment === "delivery" ? (
            <div className="space-y-2">
              <div className="space-y-1.5">
                <Label htmlFor="addr">Delivery address</Label>
                <Textarea
                  id="addr"
                  rows={2}
                  value={draft.address}
                  onChange={(e) => setDraft({ ...draft, address: e.target.value })}
                  placeholder="House / street / barangay / landmark"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="notes">Special delivery instructions (optional)</Label>
                <Input
                  id="notes"
                  value={draft.notes}
                  onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                  placeholder="Call on arrival, leave with the guard…"
                />
              </div>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label>Payment</Label>
            <div className="flex flex-wrap gap-2">
              {settings.cashEnabled ? (
                <Button
                  type="button"
                  variant={draft.payment === "cash" ? "default" : "outline"}
                  className="flex-1"
                  onClick={() => setDraft({ ...draft, payment: "cash" })}
                >
                  Cash
                </Button>
              ) : null}
              {settings.creditEnabled ? (
                <Button
                  type="button"
                  variant={draft.payment === "credit" ? "default" : "outline"}
                  className="flex-1"
                  onClick={() => setDraft({ ...draft, payment: "credit" })}
                >
                  {universeShop ? "Universe Wallet" : "Shop coins"}
                </Button>
              ) : null}
              {settings.codEnabled &&
              settings.deliveryEnabled &&
              draft.fulfillment === "delivery" ? (
                <Button
                  type="button"
                  variant={draft.payment === "cod" ? "default" : "outline"}
                  className="flex-1"
                  disabled={codQuote !== null && !codQuote.available}
                  title={
                    codQuote && !codQuote.available ? (codQuote.reason ?? undefined) : undefined
                  }
                  onClick={() => setDraft({ ...draft, payment: "cod" })}
                >
                  <Banknote className="size-4" /> Cash on delivery
                </Button>
              ) : null}
            </div>
            {draft.payment === "cod" ? (
              <div className="space-y-1 rounded-xl border border-primary/30 bg-brand-soft/40 px-3 py-2 text-sm">
                <div className="flex justify-between gap-2 text-xs text-muted-foreground">
                  <span>Products</span>
                  <span>{peso(total)}</span>
                </div>
                <div className="flex justify-between gap-2 text-xs text-muted-foreground">
                  <span>Delivery fee</span>
                  <span>{codQuote ? peso(codDeliveryFee) : "…"}</span>
                </div>
                <div className="flex justify-between gap-2 font-semibold">
                  <span>You pay in cash</span>
                  <span>{codQuote ? peso(codTotal) : "…"}</span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  No coins are taken from your wallet. Hand the exact amount to the collector on
                  delivery.
                </p>
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                {draft.payment === "credit"
                  ? `${credits(charge)} is held from your ${universeShop ? "Universe Wallet" : "wallet"} and returned in full if the order is rejected.`
                  : "Cash orders stay pending until the shop admin confirms them."}
              </p>
            )}
          </div>

          <div className="space-y-1 rounded-2xl border border-border bg-muted/40 px-3 py-2.5 text-sm">
            <div className="flex justify-between gap-2 text-xs text-muted-foreground">
              <span>
                Products ({count} item{count === 1 ? "" : "s"})
              </span>
              <span>{peso(total)}</span>
            </div>
            {draft.payment === "cod" ? (
              <div className="flex justify-between gap-2 text-xs text-muted-foreground">
                <span>Delivery fee</span>
                <span>{codQuote ? peso(codDeliveryFee) : "…"}</span>
              </div>
            ) : null}
            {draft.payment === "credit" && selfPurchase && quoteInfo ? (
              <>
                <div className="flex justify-between gap-2 text-xs text-muted-foreground">
                  <span>Retail price</span>
                  <span>{peso(quoteInfo.total)}</span>
                </div>
                <div
                  className="flex justify-between gap-2 text-xs text-success"
                  data-testid="self-cashback-line"
                >
                  <span>Your cashback (self purchase)</span>
                  <span>− {peso(quoteInfo.selfCashback)}</span>
                </div>
              </>
            ) : null}
            <div className="flex items-baseline justify-between gap-2 border-t border-border pt-1.5">
              <span className="font-semibold">
                {draft.payment === "credit" && selfPurchase ? "Actual charge" : "Total to pay"}
              </span>
              <span className="text-lg font-bold tabular-nums" data-testid="checkout-charge">
                {draft.payment === "cod" ? (codQuote ? peso(codTotal) : "…") : peso(charge)}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {draft.payment === "credit" && selfPurchase
                ? "Your cashback is applied at checkout, so only the actual charge leaves your wallet. No separate cashback is paid later."
                : "Prices, stock and fees are confirmed by the shop's system when you place the order."}
            </p>
          </div>

          {problem ? (
            <p role="alert" className="text-xs text-destructive">
              {problem}
            </p>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setCheckout(false)} disabled={busy}>
              Keep shopping
            </Button>
            <Button size="lg" onClick={() => void submit()} disabled={busy || !!problem}>
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <PackageCheck className="size-4" />
              )}
              {busy
                ? "Placing order…"
                : `Place order · ${draft.payment === "cod" ? (codQuote ? peso(codTotal) : peso(total)) : peso(charge)}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!rating} onOpenChange={(o) => !o && setRating(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rate this product</DialogTitle>
            <DialogDescription>Only products you actually received can be rated.</DialogDescription>
          </DialogHeader>
          <RatingPicker
            value={rating?.value ?? 5}
            onChange={(v) => rating && setRating({ ...rating, value: v })}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRating(null)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                if (!rating) return;
                try {
                  await rateRetailProduct(rating.order.id, rating.productId, rating.value);
                  toast.success("Thanks for rating");
                  setRating(null);
                  await load();
                } catch (e) {
                  toast.error((e as Error).message);
                }
              }}
            >
              Submit rating
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
