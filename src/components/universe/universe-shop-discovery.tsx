import { Link } from "@tanstack/react-router";
import { ArrowRight, Loader2, Search, Store, Ticket, Users } from "lucide-react";
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
import { PRESENCE_HEARTBEAT_MS, presenceLabel, presenceTone } from "@/lib/presence";

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
export function UniverseShopDiscovery({
  currentUserId,
}: {
  currentUserId?: string | null | undefined;
}) {
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
          className="h-12 rounded-lg border-border bg-card pl-10 text-base shadow-[var(--shadow-card)]"
          placeholder="Search a shop or voucher, e.g. Sagada Wave or 1 Day"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search Universe shops and vouchers"
        />
      </div>
      {loading && shops.length === 0 ? (
        <div className="space-y-3" aria-label="Loading shops">
          {[0, 1].map((item) => (
            <div
              key={item}
              className="h-48 animate-pulse rounded-lg border border-border bg-card"
            />
          ))}
        </div>
      ) : shops.length === 0 ? (
        <EmptyState
          title="No Universe shops found"
          description="Try a different shop or voucher name."
        />
      ) : (
        <div className="space-y-5">
          {shops.map((shop) => (
            <ShopResult
              key={shop.id}
              shop={shop}
              searching={q.trim().length > 0}
              currentUserId={currentUserId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ShopResult({
  shop,
  searching,
  currentUserId,
}: {
  shop: DiscoveredShop;
  searching: boolean;
  currentUserId?: string | null | undefined;
}) {
  const [showAll, setShowAll] = useState(false);
  const [sellers, setSellers] = useState<ShopSeller[] | null>(null);

  const matching = shop.products.filter((p) => p.matches);
  const visible = showAll || matching.length === 0 ? shop.products : matching;
  const hiddenCount = shop.products.length - visible.length;

  useEffect(() => {
    let active = true;
    const load = (first: boolean) =>
      fetchUniverseSellers(shop.slug)
        .then((s) => {
          if (active) setSellers(s);
        })
        .catch((e: Error) => {
          if (!active || !first) return;
          toast.error("Could not load sellers", { description: e.message });
          setSellers([]);
        });
    void load(true);
    // Presence ages: refresh the (single) ordered list once a minute while visible.
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(false);
    }, PRESENCE_HEARTBEAT_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [shop.slug]);

  return (
    <Card className="overflow-hidden rounded-lg border-border shadow-[var(--shadow-card)]">
      {/* Shop = discovery context */}
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 border-b border-border bg-brand-soft/50 px-4 py-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
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
            <ul className="grid gap-2 sm:grid-cols-2">
              {visible.map((p) => (
                <li
                  key={p.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-border bg-muted/30 px-3 py-2.5 text-xs"
                >
                  <span className="min-w-0 truncate font-semibold">{p.name}</span>
                  <span className="shrink-0 text-right font-medium text-foreground">
                    {peso(p.price)}
                    <span className="mx-1 text-muted-foreground">·</span>
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
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Users className="size-3.5" /> Choose an authorized seller
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
            <ul className="grid gap-2 sm:grid-cols-2">
              {sellers.map((s) => (
                <li key={s.sellerId}>
                  <SellerCard seller={s} currentUserId={currentUserId} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** Presence dot + coarse status ("Online", "Online 5 min ago"). */
export function PresenceBadge({ seller, now }: { seller: ShopSeller; now?: Date }) {
  const tone = presenceTone(seller, now);
  const label = presenceLabel(seller, now);
  const dot =
    tone === "online"
      ? "bg-success shadow-[0_0_0_3px_hsl(var(--success)/0.2)]"
      : tone === "recent"
        ? "bg-success/50"
        : "bg-muted-foreground/40";
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[11px] ${tone === "online" ? "font-semibold text-success" : "text-muted-foreground"}`}
      data-presence={tone}
    >
      <span aria-hidden className={`size-2 shrink-0 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

/** Action label/appearance for a seller card. Exported for unit testing. */
export function sellerCardAction(own: boolean): { text: string; icon: boolean } {
  return own ? { text: "Buy from My Shop", icon: false } : { text: "Buy", icon: true };
}

/** Premium seller card: image → full name → seller shop name → presence → action. */
export function SellerCard({
  seller,
  currentUserId,
}: {
  seller: ShopSeller;
  currentUserId?: string | null | undefined;
}) {
  const own = currentUserId === seller.sellerId;
  const action = sellerCardAction(own);
  return (
    <Link
      to="/universe/u/$handle"
      params={{ handle: seller.sellerHandle }}
      className="group grid h-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-primary/40 hover:bg-brand-soft/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="relative shrink-0">
        <MemberAvatar path={seller.avatarPath} name={seller.sellerName} className="size-12" />
        {seller.online ? (
          <span
            aria-hidden
            className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-card bg-success"
          />
        ) : null}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold leading-tight">
          {seller.sellerName}
        </span>
        <span className="mt-0.5 block truncate text-xs font-medium text-success">
          {seller.storeName}
        </span>
        <span className="mt-1 block truncate">
          <PresenceBadge seller={seller} />
        </span>
      </span>
      <span
        className={`inline-flex shrink-0 items-center justify-center rounded-md bg-primary px-2 py-1 text-[11px] font-medium leading-tight text-primary-foreground ${own ? "min-w-[5.5rem]" : "size-9"}`}
        aria-label={action.text}
      >
        {action.icon ? (
          <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
        ) : (
          action.text
        )}
      </span>
    </Link>
  );
}
