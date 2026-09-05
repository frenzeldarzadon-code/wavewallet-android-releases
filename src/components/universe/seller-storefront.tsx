import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Gift, Package, ShieldCheck, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui-kit";
import { RetailImage } from "@/components/retail/retail-image";
import { peso } from "@/lib/wavewallet";
import { fetchCreditBalance } from "@/lib/wallet";
import {
  fetchSellerStorefront,
  hasStorefront,
  type SellerStorefront,
} from "@/lib/seller-storefront";
import { VoucherPurchaseDialogs, type PurchaseTarget } from "./voucher-purchase-dialogs";
import { VoucherArtwork } from "./voucher-artwork";

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
  const [buying, setBuying] = useState<PurchaseTarget | null>(null);

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

  if (loading) return (
    <div className="space-y-3" aria-label="Loading storefront">
      <div className="h-24 animate-pulse rounded-lg border border-border bg-card" />
      <div className="h-44 animate-pulse rounded-lg border border-border bg-card" />
    </div>
  );
  if (!store || store.shops.length === 0) return null;

  const isSelf = viewerId !== null && viewerId === store.sellerId;

  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-border bg-card p-4 shadow-[var(--shadow-card)]">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-success"><ShieldCheck className="size-3.5" /> Authorized Universe seller</p>
          <h2 className="mt-1 truncate text-xl font-bold">{store.storeName}</h2>
          <p className="text-sm text-muted-foreground">Vouchers sold by {store.sellerName}</p>
        </div>
        {viewerId && balance !== null ? (
          <Link to="/universe/wallet" className="shrink-0 rounded-md bg-success-soft px-3 py-2 text-right">
            <span className="block text-[10px] font-medium uppercase text-muted-foreground">Your wallet</span>
            <span className="block text-sm font-bold text-success">{peso(balance)}</span>
          </Link>
        ) : null}
        </div>
      </div>
      {store.shops.map((shop) => (
        <Card key={shop.id} className="overflow-hidden rounded-lg shadow-[var(--shadow-card)]">
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 border-b border-border bg-brand-soft/40 px-4 py-3">
            <span className="flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground"><ShoppingBag className="size-4" /></span>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold">{shop.name}</p>
              <p className="text-xs text-muted-foreground">Choose a voucher to start checkout</p>
            </div>
          </div>
          <CardContent className="space-y-4 py-4">
            {shop.products.length === 0 ? (
              <EmptyState title="No vouchers on sale" description="Check back when this shop adds more stock." />
            ) : (
              <ul className="grid grid-cols-2 gap-3">
                {shop.products.map((p) => {
                  const open = () =>
                    setBuying({
                      shopId: shop.id,
                      shopName: shop.name,
                      creditsPerPoint: shop.creditsPerPoint ?? null,
                      product: p,
                      sellerId: isSelf ? null : store.sellerId,
                      sellerName: isSelf ? null : store.sellerName,
                      buyerId: viewerId,
                    });
                  const canBuy = Boolean(viewerId) && p.available > 0;
                  return (
                  <li key={p.id} className="grid min-w-0 grid-rows-[auto_1fr_auto] overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-card)] transition-transform hover:-translate-y-0.5 hover:border-primary/35">
                    <VoucherArtwork seed={`${shop.id}-${p.id}`} name={p.name} compact className="aspect-[16/9]" />
                    <button
                      type="button"
                      className="min-w-0 p-3 text-left disabled:cursor-default"
                      disabled={!canBuy}
                      onClick={open}
                      aria-label={`Open ${p.name}`}
                    >
                      <span className="min-w-0">
                      <span className="block line-clamp-2 text-sm font-bold leading-snug">{p.name}</span>
                      {p.description ? (
                        <span className="mt-0.5 block line-clamp-2 text-xs text-muted-foreground">{p.description}</span>
                      ) : null}
                      <span className="mt-2 block text-sm font-bold text-foreground">
                        {peso(p.price)}
                        {(p.pointsPrice ?? 0) > 0 ? (
                          <>
                            {" "}
                            · <span className="text-points">or {p.pointsPrice} pts</span>
                          </>
                        ) : null}{" "}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">{p.available > 0 ? `${p.available} available` : "Out of stock"}</span>
                      </span>
                    </button>
                     {viewerId ? (
                       <Button className="mx-3 mb-3 w-[calc(100%-1.5rem)]" size="sm" disabled={!canBuy} onClick={open}>
                        {p.available > 0 ? "Choose voucher" : "Out of stock"} <ArrowRight className="size-3.5" />
                      </Button>
                    ) : (
                        <Button asChild size="sm" variant="outline" className="mx-3 mb-3 w-[calc(100%-1.5rem)]">
                        <a href="/?mode=signin">Sign in to buy</a>
                      </Button>
                    )}
                  </li>
                  );
                })}
              </ul>
            )}
            {/* Rewards belong to the SELLING shop, never to this seller. */}
            <Link
              to="/universe/rewards/$shopId"
              params={{ shopId: shop.id }}
              search={{ name: shop.name }}
               className="flex items-center justify-between gap-3 rounded-lg border border-points/40 bg-points/8 px-3 py-3 text-sm transition-colors hover:bg-points/15"
            >
              <span className="flex min-w-0 items-center gap-2">
                <Gift className="size-4 shrink-0 text-points" />
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-points">{shop.name} Rewards</span>
                  <span className="block text-[11px] text-muted-foreground">
                    Redeem the points you earn buying {shop.name} vouchers
                  </span>
                </span>
              </span>
              <ArrowRight className="size-4 shrink-0 text-points" />
            </Link>
          </CardContent>
        </Card>
      ))}

      <VoucherPurchaseDialogs
        target={buying}
        balance={balance}
        onClose={() => setBuying(null)}
        onPurchased={load}
      />
    </section>
  );
}
