import { Link } from "@tanstack/react-router";
import { ArrowRight, Loader2, Search, Store, Ticket } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { MemberAvatar } from "@/components/member-avatar";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui-kit";
import { peso } from "@/lib/wavewallet";
import {
  fetchUniverseSellers,
  searchUniverseShops,
  type DiscoveredShop,
  type ShopSeller,
} from "@/lib/seller-storefront";

/**
 * Customer-facing Universe discovery. A Universe shop is the discovery
 * context: it shows its available vouchers and, critically, the authorized
 * seller storefronts that sell them. There is deliberately NO direct
 * "buy from shop" path here — every purchase terminates at a seller's
 * storefront (/universe/u/$handle), where the Phase 1 seller-attributed
 * purchase engine and the global Universe wallet do the work.
 *
 * Seller cards show public identity only: photo, name and storefront name.
 * Roles, hierarchy, rates and wallets never reach this surface.
 */
export function UniverseShopDiscovery() {
  const [q, setQ] = useState("");
  const [shops, setShops] = useState<DiscoveredShop[]>([]);
  const [loading, setLoading] = useState(true);

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
    <div className="space-y-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="h-11 rounded-xl pl-9 shadow-[var(--shadow-card)]"
          placeholder="Search a shop or voucher, e.g. Sagada Wave or 1 Day"
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
        <div className="space-y-5">
          {shops.map((shop) => (
            <ShopResult key={shop.id} shop={shop} searching={q.trim().length > 0} />
          ))}
        </div>
      )}
    </div>
  );
}

function ShopResult({ shop, searching }: { shop: DiscoveredShop; searching: boolean }) {
  const [showAll, setShowAll] = useState(false);
  const [sellers, setSellers] = useState<ShopSeller[] | null>(null);

  const matching = shop.products.filter((p) => p.matches);
  const visible = showAll || matching.length === 0 ? shop.products : matching;
  const hiddenCount = shop.products.length - visible.length;

  useEffect(() => {
    let active = true;
    fetchUniverseSellers(shop.slug)
      .then((s) => {
        if (active) setSellers(s);
      })
      .catch((e: Error) => {
        if (!active) return;
        toast.error("Could not load sellers", { description: e.message });
        setSellers([]);
      });
    return () => {
      active = false;
    };
  }, [shop.slug]);

  return (
    <Card className="overflow-hidden border-border/70 shadow-[var(--shadow-card)]">
      {/* Shop = discovery context */}
      <div className="flex items-start gap-3 bg-gradient-to-r from-primary/10 via-primary/5 to-success/10 px-4 py-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
          <Store className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Universe shop
          </p>
          <h3 className="truncate text-base font-bold leading-tight">{shop.name}</h3>
          {shop.description ? (
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{shop.description}</p>
          ) : null}
        </div>
      </div>

      <CardContent className="space-y-4 py-4">
        {/* Products (context only — no checkout here) */}
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Ticket className="size-3.5" /> Available vouchers
          </p>
          {shop.products.length === 0 ? (
            <p className="text-xs text-muted-foreground">No vouchers on sale right now.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {visible.map((p) => (
                <li
                  key={p.id}
                  className="rounded-lg border border-border bg-muted/40 px-3 py-1.5 text-xs"
                >
                  <span className="font-semibold">{p.name}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    · {peso(p.price)} ·{" "}
                    {p.available > 0 ? (
                      <span className="text-success">{p.available} available</span>
                    ) : (
                      <span className="text-destructive">Out of stock</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {searching && hiddenCount > 0 ? (
            <button
              type="button"
              className="mt-2 text-xs font-medium text-primary underline-offset-2 hover:underline"
              onClick={() => setShowAll(true)}
            >
              Show {hiddenCount} more voucher{hiddenCount === 1 ? "" : "s"} from this shop
            </button>
          ) : null}
        </div>

        {/* Sellers — the only way to buy */}
        <div>
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Buy from a seller
            </p>
            {sellers && sellers.length > 0 ? (
              <p className="text-[11px] text-muted-foreground">
                {sellers.length} seller{sellers.length === 1 ? "" : "s"}
              </p>
            ) : null}
          </div>
          {sellers === null ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" /> Loading sellers…
            </p>
          ) : sellers.length === 0 ? (
            <p className="text-xs text-muted-foreground">No sellers listed yet.</p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {sellers.map((s) => (
                <li key={s.sellerId}>
                  <SellerCard seller={s} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** Premium seller card: image → full name → seller shop name → View My Shop →. */
function SellerCard({ seller }: { seller: ShopSeller }) {
  return (
    <Link
      to="/universe/u/$handle"
      params={{ handle: seller.sellerHandle }}
      className="group flex h-full flex-col items-center rounded-2xl border border-border bg-card p-3 text-center shadow-[var(--shadow-card)] transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="rounded-full bg-gradient-to-br from-primary to-success p-[2px]">
        <MemberAvatar
          path={seller.avatarPath}
          name={seller.sellerName}
          className="size-16 border-2 border-card text-base"
        />
      </span>
      <p className="mt-2 w-full truncate text-sm font-semibold leading-tight">{seller.sellerName}</p>
      <p className="w-full truncate text-xs font-medium text-success">{seller.storeName}</p>
      <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground transition-colors group-hover:bg-primary/90">
        View My Shop <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}
