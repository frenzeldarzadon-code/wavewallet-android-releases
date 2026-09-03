/**
 * Retail store for members of one shop.
 *
 * Visually a sibling of the voucher shop, but for physical goods: many
 * products and quantities go into one cart, and checkout asks for pickup or
 * delivery and the payment method the shop admin enabled. Credits are only
 * held when the order is placed and are returned in full if the admin rejects
 * it, so nothing is spent until an order is confirmed.
 */
import {
  Banknote,
  Loader2,
  MessageCircle,
  PackageCheck,
  ShoppingCart,
  Star,
  Store,
  Truck,
  X,
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { EmptyState, PageSection, StatusBadge } from "@/components/ui-kit";
import { RatingPicker } from "@/components/rating-stars";
import { RETAIL_VISIBLE } from "@/lib/features";
import { useSession } from "@/lib/session";
import { fetchCreditBalance } from "@/lib/wallet";
import { peso, shortDateTime } from "@/lib/wavewallet";
import {
  DEFAULT_STORE_SETTINGS,
  canCancelOrder,
  canConfirmReceipt,
  cancelRetailOrder,
  codCashTotal,
  codCustomerTotal,
  customerCancelBlockedReason,
  customerNextStep,
  fulfillmentLabel,
  fulfillmentTone,
  updateRetailFulfillment,
  cartCount,
  cartLines,
  cartQuote,
  changeQuantity,
  checkoutProblem,
  fetchMyRetailOrders,
  fetchRetailFeePercent,
  fetchRetailProducts,
  sellerToCustomer,
  fetchStoreSettings,
  placeRetailOrder,
  rateRetailProduct,
  type Cart,
  type CheckoutDraft,
  type CodQuote,
  type RetailOrder,
  type RetailProduct,
  type StoreSettings,
} from "@/lib/retail";
import { codStageLabel, fetchCodQuote, openOrderChat } from "@/lib/retail-cod";
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

const credits = (n: number) => `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} coins`;

export function RetailStoreView({ role }: { role: "customer" | "reseller" }) {
  const { account, ecosystem, ecosystemDbId } = useSession(role);
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
  const [detailId, setDetailId] = useState<string | null>(null);
  const [catalogQuery, setCatalogQuery] = useState<CatalogQuery>(DEFAULT_CATALOG_QUERY);
  const [pageLimit, setPageLimit] = useState(CATALOG_PAGE_SIZE);
  const [busy, setBusy] = useState(false);
  const [codQuote, setCodQuote] = useState<CodQuote | null>(null);
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

  const load = useCallback(async () => {
    if (!ecosystemDbId || !userId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [p, s, o, b, f] = await Promise.all([
        fetchRetailProducts(ecosystemDbId),
        fetchStoreSettings(ecosystemDbId),
        fetchMyRetailOrders(ecosystemDbId),
        fetchCreditBalance(userId, ecosystemDbId),
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
  }, [ecosystemDbId, userId]);

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

  if (!account || !ecosystemDbId) return null;

  const problem = checkoutProblem(draft, total, settings, balance, count, codQuote);
  const codDeliveryFee = codQuote?.deliveryFee ?? settings.deliveryFee;
  const codTotal = codCustomerTotal(total, codDeliveryFee);

  const goToChat = async (o: RetailOrder) => {
    try {
      const thread = await openOrderChat(o.id);
      void navigate({ to: "/universe/messages", search: { thread } });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const submit = async () => {
    setBusy(true);
    try {
      const placed = await placeRetailOrder(ecosystemDbId, cart, draft);
      toast.success(`Order ${placed.orderNo} sent for approval`, {
        description:
          draft.payment === "credit"
            ? "Your coins are held until the shop admin approves or rejects."
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

  const shopName = ecosystem?.name ?? "Retail shop";
  const detailProduct = detailId ? (products.find((p) => p.id === detailId) ?? null) : null;

  return (
    <>
      <MarketplaceHeader
        shopName={shopName}
        description={ecosystem?.description ?? null}
        productCount={products.length}
        search={catalogQuery.search}
        onSearch={(search) => setCatalogQuery((q) => ({ ...q, search }))}
        cartCount={count}
        onOpenCart={() => setCartOpen(true)}
        aside={<EcosystemSwitcher mini />}
        logoPath={settings.logoPath}
        coverPath={settings.coverPath}
        acceptingOrders={settings.acceptingOrders}
        pausedNote={settings.pausedNote}
      />

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

      <PageSection
        devSlot="retail-store-view.my-orders"
        title="My orders"
        description="Track each order from review to hand-over."
      >
        {orders.length === 0 ? (
          <EmptyState title="No retail orders yet" />
        ) : (
          <div className="space-y-2">
            {orders.map((o) => (
              <Card key={o.id} className="shadow-[var(--shadow-card)]">
                <CardContent className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{o.order_no}</p>
                      <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Store className="size-3" />
                        {o.shop_name ?? "Shop"}
                        {o.seller_name ? ` · sold by ${o.seller_name}` : ""}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {shortDateTime(o.created_at)} · {o.fulfillment} · {o.payment_method}
                      </p>
                    </div>
                    <StatusBadge tone={fulfillmentTone(o)}>
                      {o.status === "approved"
                        ? fulfillmentLabel(o.fulfillment_status, o.fulfillment)
                        : o.status}
                    </StatusBadge>
                  </div>
                  <p className="rounded-lg bg-muted/60 px-2.5 py-1.5 text-xs">
                    {customerNextStep(o)}
                  </p>
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {o.items.map((i) => (
                      <li key={i.product_id} className="flex justify-between gap-2">
                        <span>
                          {i.quantity} × {i.name}
                        </span>
                        <span>{credits(i.line_total)}</span>
                      </li>
                    ))}
                  </ul>
                  {o.fulfillment === "delivery" ? (
                    <div className="space-y-1 rounded-xl border border-border px-3 py-2 text-[11px] text-muted-foreground">
                      <p className="flex items-center gap-1 font-medium text-foreground">
                        <Truck className="size-3.5 text-primary" /> Delivery details
                      </p>
                      {o.delivery_address ? (
                        <p>
                          Deliver to: {o.delivery_address}
                          {o.delivery_notes ? ` · ${o.delivery_notes}` : ""}
                        </p>
                      ) : null}
                      {o.status === "approved" ? (
                        <p>
                          {o.self_delivery
                            ? "Delivered by the seller"
                            : o.delivery_person_name
                              ? `Delivery person: ${o.delivery_person_name}`
                              : "Delivery person not assigned yet"}
                          {o.payment_method === "cod" && o.collector_name
                            ? ` · Cash collected by: ${o.collector_name}`
                            : ""}
                        </p>
                      ) : null}
                      {o.payment_method === "cod" ? (
                        <p>
                          Cash on delivery: {peso(o.total)} products + {peso(o.delivery_fee ?? 0)}{" "}
                          delivery ={" "}
                          <strong className="text-foreground">{peso(codCashTotal(o))}</strong> ·{" "}
                          {codStageLabel(o)}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold">
                      {o.payment_method === "cod"
                        ? `Pay ${peso(codCashTotal(o))} cash`
                        : `Total ${credits(o.total)}`}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {o.fulfillment === "delivery" && o.status === "approved" ? (
                        <Button size="sm" variant="outline" onClick={() => void goToChat(o)}>
                          <MessageCircle className="size-4" /> Order chat
                        </Button>
                      ) : null}
                      {canConfirmReceipt(o) ? (
                        <Button
                          size="sm"
                          onClick={async () => {
                            try {
                              await updateRetailFulfillment(o.id, "completed");
                              toast.success("Thanks — order marked as received");
                              await load();
                            } catch (e) {
                              toast.error((e as Error).message);
                            }
                          }}
                        >
                          <PackageCheck className="size-4" /> I received it
                        </Button>
                      ) : null}
                      {canCancelOrder(o) ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            try {
                              await cancelRetailOrder(o.id);
                              toast.success("Order cancelled — nothing was charged");
                              await load();
                            } catch (e) {
                              toast.error((e as Error).message);
                            }
                          }}
                        >
                          <X className="size-4" /> Cancel
                        </Button>
                      ) : customerCancelBlockedReason(o) ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled
                          title={customerCancelBlockedReason(o) ?? undefined}
                        >
                          <X className="size-4" /> Cancel
                        </Button>
                      ) : null}
                      {o.status === "approved" && o.fulfillment_status === "completed"
                        ? o.items.map((i) => (
                            <Button
                              key={i.product_id}
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                setRating({ order: o, productId: i.product_id, value: 5 })
                              }
                            >
                              <Star className="size-4" /> Rate {i.name}
                            </Button>
                          ))
                        : null}
                    </div>
                  </div>
                  {o.decision_note ? (
                    <p className="text-[11px] text-muted-foreground">Note: {o.decision_note}</p>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </PageSection>

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
                  Shop coins
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
                  ? `${credits(total)} is held from this shop's wallet and returned in full if the order is rejected.`
                  : "Cash orders stay pending until the shop admin confirms them."}
              </p>
            )}
          </div>

          {problem ? <p className="text-xs text-destructive">{problem}</p> : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setCheckout(false)} disabled={busy}>
              Keep shopping
            </Button>
            <Button onClick={() => void submit()} disabled={busy || !!problem}>
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <PackageCheck className="size-4" />
              )}
              Place order
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
