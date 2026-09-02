import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui-kit";
import { peso } from "@/lib/wavewallet";
import { fetchCreditBalance } from "@/lib/wallet";
import { fetchSellerStorefront, type SellerStorefront } from "@/lib/seller-storefront";
import { VoucherPurchaseDialogs, type PurchaseTarget } from "./voucher-purchase-dialogs";

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

  if (loading) return <p className="text-sm text-muted-foreground">Loading vouchers…</p>;
  if (!store || store.shops.length === 0) return null;

  const isSelf = viewerId !== null && viewerId === store.sellerId;

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-base font-bold text-success">{store.storeName}</h2>
          <p className="text-xs text-muted-foreground">Vouchers sold by {store.sellerName}</p>
        </div>
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
                {shop.products.map((p) => {
                  const open = () =>
                    setBuying({
                      shopId: shop.id,
                      shopName: shop.name,
                      product: p,
                      sellerId: isSelf ? null : store.sellerId,
                      sellerName: isSelf ? null : store.sellerName,
                      buyerId: viewerId,
                    });
                  const canBuy = Boolean(viewerId) && p.available > 0;
                  return (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left disabled:cursor-default"
                      disabled={!canBuy}
                      onClick={open}
                      aria-label={`Open ${p.name}`}
                    >
                      <p className="truncate text-sm font-medium">{p.name}</p>
                      {p.description ? (
                        <p className="truncate text-xs text-muted-foreground">{p.description}</p>
                      ) : null}
                      <p className="text-xs text-muted-foreground">
                        {peso(p.price)}
                        {(p.pointsPrice ?? 0) > 0 ? (
                          <>
                            {" "}
                            · <span className="text-points">or {p.pointsPrice} pts</span>
                          </>
                        ) : null}{" "}
                        · {p.available > 0 ? `${p.available} available` : "Out of stock"}
                      </p>
                    </button>
                    {viewerId ? (
                      <Button size="sm" disabled={!canBuy} onClick={open}>
                        Buy
                      </Button>
                    ) : (
                      <Button asChild size="sm" variant="outline">
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
              className="flex items-center justify-between gap-3 rounded-xl border border-points/40 bg-points/8 px-3 py-2.5 text-sm transition-colors hover:bg-points/15"
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
