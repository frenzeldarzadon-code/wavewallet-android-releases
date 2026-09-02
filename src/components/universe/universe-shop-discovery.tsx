import { Link } from "@tanstack/react-router";
import { ChevronDown, ChevronUp, Loader2, Search, Store, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { MemberAvatar } from "@/components/member-avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui-kit";
import { peso } from "@/lib/wavewallet";
import { fetchCreditBalance } from "@/lib/wallet";
import {
  fetchUniverseSellers,
  searchUniverseShops,
  type DiscoveredShop,
  type ShopSeller,
} from "@/lib/seller-storefront";
import { VoucherPurchaseDialogs, type PurchaseTarget } from "./voucher-purchase-dialogs";

/**
 * Customer-facing Universe discovery: search Universe shops by shop or voucher
 * name, browse the sellers authorized for a shop (identity only — never the
 * hierarchy) or buy directly from the shop through the Phase 1 purchase engine.
 */
export function UniverseShopDiscovery({ viewerId }: { viewerId: string }) {
  const [q, setQ] = useState("");
  const [shops, setShops] = useState<DiscoveredShop[]>([]);
  const [loading, setLoading] = useState(true);
  const [balance, setBalance] = useState<number | null>(null);
  const [buying, setBuying] = useState<PurchaseTarget | null>(null);

  const loadBalance = useCallback(async () => {
    setBalance(await fetchCreditBalance(viewerId, null).catch(() => null));
  }, [viewerId]);

  useEffect(() => {
    void loadBalance();
  }, [loadBalance]);

  useEffect(() => {
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        setShops(await searchUniverseShops(q.trim()));
      } catch (e) {
        toast.error("Search failed", { description: (e as Error).message });
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [q]);

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Shop or voucher name, e.g. Sagada Wave or 1 Day"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search Universe shops and vouchers"
        />
      </div>
      {loading && shops.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Searching…
        </p>
      ) : shops.length === 0 ? (
        <EmptyState
          title="No Universe shops found"
          description="Try a different shop or voucher name."
        />
      ) : (
        <div className="space-y-3">
          {shops.map((shop) => (
            <ShopResult
              key={shop.id}
              shop={shop}
              searching={q.trim().length > 0}
              onBuy={(product) =>
                setBuying({ shopName: shop.name, product, sellerId: null, sellerName: null })
              }
            />
          ))}
        </div>
      )}

      <VoucherPurchaseDialogs
        target={buying}
        balance={balance}
        onClose={() => setBuying(null)}
        onPurchased={async () => {
          await loadBalance();
          setShops(await searchUniverseShops(q.trim()).catch(() => shops));
        }}
      />
    </div>
  );
}

function ShopResult({
  shop,
  searching,
  onBuy,
}: {
  shop: DiscoveredShop;
  searching: boolean;
  onBuy: (product: DiscoveredShop["products"][number]) => void;
}) {
  const [showSellers, setShowSellers] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [sellers, setSellers] = useState<ShopSeller[] | null>(null);
  const [sellersBusy, setSellersBusy] = useState(false);

  const matching = shop.products.filter((p) => p.matches);
  const visible = showAll || matching.length === 0 ? shop.products : matching;
  const hiddenCount = shop.products.length - visible.length;

  const toggleSellers = async () => {
    const next = !showSellers;
    setShowSellers(next);
    if (next && sellers === null) {
      setSellersBusy(true);
      try {
        setSellers(await fetchUniverseSellers(shop.slug));
      } catch (e) {
        toast.error("Could not load sellers", { description: (e as Error).message });
        setSellers([]);
      } finally {
        setSellersBusy(false);
      }
    }
  };

  return (
    <Card className="shadow-[var(--shadow-card)]">
      <CardContent className="space-y-3 py-4">
        <div className="flex items-start gap-3">
          <Store className="mt-0.5 size-5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{shop.name}</p>
            {shop.description ? (
              <p className="line-clamp-2 text-xs text-muted-foreground">{shop.description}</p>
            ) : null}
          </div>
        </div>

        {shop.products.length === 0 ? (
          <p className="text-xs text-muted-foreground">No vouchers on sale right now.</p>
        ) : (
          <ul className="divide-y">
            {visible.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{p.name}</p>
                  {p.description ? (
                    <p className="truncate text-xs text-muted-foreground">{p.description}</p>
                  ) : null}
                  <p className="text-xs text-muted-foreground">
                    {peso(p.price)} · {p.available > 0 ? `${p.available} available` : "Out of stock"}
                  </p>
                </div>
                <Button size="sm" disabled={p.available <= 0} onClick={() => onBuy(p)}>
                  Buy from shop
                </Button>
              </li>
            ))}
          </ul>
        )}
        {searching && hiddenCount > 0 ? (
          <button
            type="button"
            className="text-xs font-medium text-primary underline-offset-2 hover:underline"
            onClick={() => setShowAll(true)}
          >
            Show {hiddenCount} more voucher{hiddenCount === 1 ? "" : "s"} from this shop
          </button>
        ) : null}

        <div className="border-t pt-3">
          <Button variant="outline" size="sm" className="w-full" onClick={() => void toggleSellers()}>
            <Users className="size-4" />
            Browse sellers
            {showSellers ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </Button>
          {showSellers ? (
            sellersBusy ? (
              <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" /> Loading sellers…
              </p>
            ) : (sellers?.length ?? 0) === 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">No sellers listed yet.</p>
            ) : (
              <ul className="mt-2 divide-y">
                {sellers!.map((s) => (
                  <li key={s.sellerId}>
                    <Link
                      to="/universe/u/$handle"
                      params={{ handle: s.sellerHandle }}
                      className="flex items-center gap-3 py-2 hover:bg-muted/50"
                    >
                      <MemberAvatar path={s.avatarPath} name={s.sellerName} className="size-9" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{s.sellerName}</p>
                        <p className="truncate text-xs text-muted-foreground">@{s.sellerHandle}</p>
                      </div>
                      <span className="text-xs text-primary">View vouchers</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
