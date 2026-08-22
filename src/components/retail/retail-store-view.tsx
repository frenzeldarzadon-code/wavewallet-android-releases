/**
 * Retail store for members of one shop.
 *
 * Visually a sibling of the voucher shop, but for physical goods: many
 * products and quantities go into one cart, and checkout asks for pickup or
 * delivery and the payment method the shop admin enabled. Credits are only
 * held when the order is placed and are returned in full if the admin rejects
 * it, so nothing is spent until an order is confirmed.
 */
import { Loader2, Minus, PackageCheck, Plus, ShoppingCart, Star, X } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, PageSection, StatusBadge } from "@/components/ui-kit";
import { RatingPicker, RatingStars } from "@/components/rating-stars";
import { RetailImage } from "@/components/retail/retail-image";
import { RETAIL_VISIBLE } from "@/lib/features";
import { useSession } from "@/lib/session";
import { fetchCreditBalance } from "@/lib/wallet";
import { shortDateTime } from "@/lib/wavewallet";
import {
  DEFAULT_STORE_SETTINGS,
  cancelRetailOrder,
  cartCount,
  cartLines,
  cartTotal,
  changeQuantity,
  checkoutProblem,
  fetchMyRetailOrders,
  fetchRetailProducts,
  fetchStoreSettings,
  orderTone,
  placeRetailOrder,
  rateRetailProduct,
  type Cart,
  type CheckoutDraft,
  type RetailOrder,
  type RetailProduct,
  type StoreSettings,
} from "@/lib/retail";

const credits = (n: number) => `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} coins`;

export function RetailStoreView({ role }: { role: "customer" | "reseller" }) {
  const { account, ecosystemDbId } = useSession(role);
  const [products, setProducts] = useState<RetailProduct[]>([]);
  const [settings, setSettings] = useState<StoreSettings>(DEFAULT_STORE_SETTINGS);
  const [orders, setOrders] = useState<RetailOrder[]>([]);
  const [balance, setBalance] = useState(0);
  const [cart, setCart] = useState<Cart>({});
  const [loading, setLoading] = useState(true);
  const [checkout, setCheckout] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<CheckoutDraft>({
    fulfillment: null,
    payment: null,
    address: "",
    notes: "",
  });
  const [rating, setRating] = useState<{ order: RetailOrder; productId: string; value: number } | null>(
    null,
  );
  const userId = account?.id ?? null;

  const load = useCallback(async () => {
    if (!ecosystemDbId || !userId) return;
    setLoading(true);
    try {
      const [p, s, o, b] = await Promise.all([
        fetchRetailProducts(ecosystemDbId),
        fetchStoreSettings(ecosystemDbId),
        fetchMyRetailOrders(ecosystemDbId),
        fetchCreditBalance(userId, ecosystemDbId),
      ]);
      setProducts(p);
      setSettings(s);
      setOrders(o);
      setBalance(b);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [ecosystemDbId, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!account || !ecosystemDbId) return null;

  const lines = cartLines(cart, products);
  const total = cartTotal(cart, products);
  const count = cartCount(cart);
  const problem = checkoutProblem(draft, total, settings, balance, count);

  const submit = async () => {
    setBusy(true);
    try {
      const placed = await placeRetailOrder(ecosystemDbId, cart, draft);
      toast.success(`Order ${placed.orderNo} sent for approval`, {
        description:
          draft.payment === "credit"
            ? "Your coins are held until the shop admin approves or rejects."
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

  return (
    <>
      <PageSection devSlot="retail-store-view.retail-store-2"
        title="Retail store"
        description={`Physical goods from this shop · wallet: ${credits(balance)}`}
        action={
          count > 0 ? (
            <Button size="sm" onClick={() => setCheckout(true)}>
              <ShoppingCart className="size-4" /> Cart ({count})
            </Button>
          ) : null
        }
      >
        {loading ? (
          <p className="text-xs text-muted-foreground">Loading products…</p>
        ) : products.length === 0 ? (
          <EmptyState title="No retail products yet" description="Check back soon." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {products.map((p) => {
              const qty = cart[p.id] ?? 0;
              return (
                <Card key={p.id} className="overflow-hidden shadow-[var(--shadow-card)]">
                  <RetailImage path={p.image_path} alt={p.name} />
                  <CardContent className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold">{p.name}</p>
                        {[p.brand, p.variant, p.size_label].filter(Boolean).length > 0 ? (
                          <p className="text-[11px] text-muted-foreground">
                            {[p.brand, p.variant, p.size_label].filter(Boolean).join(" · ")}
                          </p>
                        ) : null}
                      </div>
                      <StatusBadge tone={p.stock > 0 ? "success" : "danger"}>
                        {p.stock > 0 ? `${p.stock} in stock` : "Out of stock"}
                      </StatusBadge>
                    </div>
                    {p.description ? (
                      <p className="text-xs text-muted-foreground">{p.description}</p>
                    ) : null}
                    {(p.wholesale_price ?? 0) > 0 && (p.wholesale_min_qty ?? 0) > 0 ? (
                      <p className="text-[11px] font-medium text-success">
                        {credits(p.wholesale_price ?? 0)} each from {p.wholesale_min_qty}{" "}
                        {p.unit ?? "piece"}s
                      </p>
                    ) : null}
                    <RatingStars avg={p.rating_avg} count={p.rating_count} />
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <p className="text-sm font-semibold text-primary">{credits(p.price)}</p>
                      {qty > 0 ? (
                        <div className="flex items-center gap-2">
                          <Button
                            size="icon"
                            variant="outline"
                            className="size-9"
                            aria-label={`Remove one ${p.name}`}
                            onClick={() => setCart(changeQuantity(cart, p, -1))}
                          >
                            <Minus className="size-4" />
                          </Button>
                          <span className="w-6 text-center text-sm font-semibold">{qty}</span>
                          <Button
                            size="icon"
                            variant="outline"
                            className="size-9"
                            aria-label={`Add one ${p.name}`}
                            disabled={qty >= p.stock}
                            onClick={() => setCart(changeQuantity(cart, p, 1))}
                          >
                            <Plus className="size-4" />
                          </Button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          disabled={p.stock === 0}
                          onClick={() => setCart(changeQuantity(cart, p, 1))}
                        >
                          <Plus className="size-4" /> Add
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </PageSection>

      <PageSection devSlot="retail-store-view.my-orders" title="My orders" description="Every order stays pending until the shop admin reviews it.">
        {orders.length === 0 ? (
          <EmptyState title="No retail orders yet" />
        ) : (
          <div className="space-y-2">
            {orders.map((o) => (
              <Card key={o.id} className="shadow-[var(--shadow-card)]">
                <CardContent className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">{o.order_no}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {shortDateTime(o.created_at)} · {o.fulfillment} · {o.payment_method}
                      </p>
                    </div>
                    <StatusBadge tone={orderTone(o.status)}>{o.status}</StatusBadge>
                  </div>
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
                  {o.delivery_address ? (
                    <p className="text-[11px] text-muted-foreground">
                      Deliver to: {o.delivery_address}
                      {o.delivery_notes ? ` · ${o.delivery_notes}` : ""}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold">Total {credits(o.total)}</p>
                    <div className="flex gap-2">
                      {o.status === "pending" ? (
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
                      ) : null}
                      {o.status === "approved"
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
                </span>
                <span>{credits(l.lineTotal)}</span>
              </li>
            ))}
          </ul>

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
            <div className="flex gap-2">
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
            </div>
            <p className="text-[11px] text-muted-foreground">
              {draft.payment === "credit"
                ? `${credits(total)} is held from this shop's wallet and returned in full if the order is rejected.`
                : "Cash orders stay pending until the shop admin confirms them."}
            </p>
          </div>

          {problem ? <p className="text-xs text-destructive">{problem}</p> : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setCheckout(false)} disabled={busy}>
              Keep shopping
            </Button>
            <Button onClick={() => void submit()} disabled={busy || !!problem}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <PackageCheck className="size-4" />}
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
