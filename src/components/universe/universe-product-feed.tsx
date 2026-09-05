/**
 * All Products — the Universe-wide marketplace feed.
 *
 * Mixes vouchers and retail goods from every eligible public Universe shop.
 * Vouchers stay immediate purchases: tapping one opens the shop's authorized
 * sellers and the buy happens on the seller's storefront. Retail products open
 * the shop's existing retail store (cart/checkout) on that product.
 */
import { Link } from "@tanstack/react-router";
import { Flame, Loader2, Package, Sparkles, Star, Store, Ticket, Users } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { EmptyState } from "@/components/ui-kit";
import { RetailImage } from "@/components/retail/retail-image";
import { SellerCard } from "@/components/universe/universe-shop-discovery";
import { VoucherArtwork } from "@/components/universe/voucher-artwork";
import { cn } from "@/lib/utils";
import { peso } from "@/lib/wavewallet";
import { fetchUniverseSellers, type ShopSeller } from "@/lib/seller-storefront";
import {
  FEED_PAGE_SIZE,
  feedBadge,
  fetchProductCategories,
  fetchProductFeed,
  mergeFeedPages,
  recordProductView,
  sessionSeed,
  type FeedProduct,
  type FeedSection,
} from "@/lib/universe-products";

const SECTIONS: Array<{ id: FeedSection; label: string; icon: typeof Flame }> = [
  { id: "all", label: "All Products", icon: Sparkles },
  { id: "trending", label: "Trending", icon: Flame },
  { id: "new", label: "New", icon: Package },
];

export function UniverseProductFeed({ currentUserId }: { currentUserId?: string | null | undefined }) {
  const [section, setSection] = useState<FeedSection>("all");
  const [category, setCategory] = useState<string | null>(null);
  const [categories, setCategories] = useState<Array<{ category: string; count: number }>>([]);
  const [items, setItems] = useState<FeedProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [done, setDone] = useState(false);
  const [voucherPick, setVoucherPick] = useState<FeedProduct | null>(null);
  const seed = useRef(0);
  const sentinel = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    seed.current = sessionSeed();
    fetchProductCategories()
      .then(setCategories)
      .catch(() => undefined);
  }, []);

  const load = useCallback(
    async (reset: boolean) => {
      setLoading(true);
      try {
        const offset = reset ? 0 : items.length;
        const page = await fetchProductFeed({ section, category, seed: seed.current, offset });
        setItems((prev) => (reset ? page : mergeFeedPages(prev, page)));
        setDone(page.length < FEED_PAGE_SIZE);
      } catch (e) {
        toast.error("Could not load products", { description: (e as Error).message });
      } finally {
        setLoading(false);
      }
    },
    [section, category, items.length],
  );

  // Reset whenever the section or category changes.
  useEffect(() => {
    setItems([]);
    setDone(false);
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, category]);

  // Infinite scroll.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || done) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !loading) void load(false);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [load, loading, done]);

  return (
    <div className="space-y-4">
      {/* Sections */}
      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Product sections">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={section === s.id}
            onClick={() => setSection(s.id)}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-semibold transition-colors",
              section === s.id
                ? "border-primary bg-primary text-primary-foreground shadow-sm"
                : "border-border bg-card text-foreground hover:bg-brand-soft/40",
            )}
          >
            <s.icon className="size-4" /> {s.label}
          </button>
        ))}
      </div>

      {/* Categories (only ones that actually have products on sale) */}
      <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Categories">
        {[
          { category: null as string | null, count: 0, label: "Everything" },
          { category: "Vouchers", count: 0, label: "WiFi vouchers" },
          ...categories.map((c) => ({ ...c, label: c.category })),
        ].map((c) => (
          <button
            key={c.label}
            type="button"
            aria-pressed={category === c.category}
            onClick={() => setCategory(c.category)}
            className={cn(
              "shrink-0 rounded-md border px-3 py-1.5 text-xs font-medium",
              category === c.category
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {c.label}
          </button>
        ))}
      </div>

      {items.length === 0 && loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Loading products">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-64 animate-pulse rounded-lg border border-border bg-card" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title="Nothing on sale here yet"
          description="Try another section or category."
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {items.map((p) => (
            <ProductCard
              key={`${p.kind}:${p.id}`}
              product={p}
              onVoucher={() => {
                recordProductView("voucher", p.id);
                setVoucherPick(p);
              }}
              onRetail={() => recordProductView("retail", p.id)}
            />
          ))}
        </div>
      )}

      <div ref={sentinel} className="flex justify-center py-3">
        {loading && items.length > 0 ? (
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        ) : !done && items.length > 0 ? (
          <Button variant="outline" size="sm" onClick={() => void load(false)}>
            Show more
          </Button>
        ) : items.length > 0 ? (
          <p className="text-xs text-muted-foreground">You’ve seen everything on sale right now.</p>
        ) : null}
      </div>

      <VoucherSellerSheet
        product={voucherPick}
        onClose={() => setVoucherPick(null)}
        currentUserId={currentUserId}
      />
    </div>
  );
}

function ProductCard({
  product: p,
  onVoucher,
  onRetail,
}: {
  product: FeedProduct;
  onVoucher: () => void;
  onRetail: () => void;
}) {
  const badge = feedBadge(p);
  const body = (
    <>
      <div className="relative">
        {p.kind === "voucher" ? (
          <VoucherArtwork seed={p.id} name={p.name} compact />
        ) : (
          <RetailImage
            path={p.imagePath}
            alt={p.name}
            className="aspect-[16/10] w-full rounded-none"
          />
        )}
        {badge ? (
          <span
            className={cn(
              "absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide shadow-sm",
              p.isTrending
                ? "bg-destructive text-destructive-foreground"
                : "bg-card text-foreground",
            )}
          >
            {badge}
          </span>
        ) : null}
        <span
          className="absolute right-2 top-2 rounded-full bg-card/90 p-1 text-muted-foreground"
          aria-hidden
        >
          {p.kind === "voucher" ? (
            <Ticket className="size-3.5" />
          ) : (
            <Package className="size-3.5" />
          )}
        </span>
      </div>
      <div className="space-y-1 p-3">
        <p className="line-clamp-2 text-sm font-semibold leading-tight">{p.name}</p>
        <p className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
          <Store className="size-3 shrink-0" /> <span className="truncate">{p.shopName}</span>
        </p>
        <div className="flex items-baseline justify-between gap-2 pt-1">
          <span className="text-base font-bold text-foreground">{peso(p.price)}</span>
          {p.ratingCount > 0 ? (
            <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-warning">
              <Star className="size-3 fill-current" /> {p.ratingAvg.toFixed(1)}
            </span>
          ) : (
            <span className="text-[11px] text-success">{p.available} left</span>
          )}
        </div>
        <span
          className={cn(
            "mt-1 block rounded-md py-1.5 text-center text-xs font-semibold",
            p.kind === "voucher"
              ? "bg-primary text-primary-foreground"
              : "bg-success text-success-foreground",
          )}
        >
          {p.kind === "voucher" ? "Buy voucher" : "View in store"}
        </span>
      </div>
    </>
  );
  const cls =
    "group block overflow-hidden rounded-lg border border-border bg-card text-left shadow-[var(--shadow-card)] transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  if (p.kind === "retail") {
    return (
      <Link
        to="/universe/store/$slug"
        params={{ slug: p.shopSlug }}
        search={{ product: p.id }}
        className={cls}
        onClick={onRetail}
      >
        {body}
      </Link>
    );
  }
  return (
    <button type="button" className={cls} onClick={onVoucher}>
      {body}
    </button>
  );
}

/** Voucher = immediate purchase through an authorized seller's storefront (existing flow). */
function VoucherSellerSheet({
  product,
  onClose,
  currentUserId,
}: {
  product: FeedProduct | null;
  onClose: () => void;
  currentUserId?: string | null | undefined;
}) {
  const [sellers, setSellers] = useState<ShopSeller[] | null>(null);
  useEffect(() => {
    if (!product) return;
    let alive = true;
    setSellers(null);
    fetchUniverseSellers(product.shopSlug)
      .then((s) => alive && setSellers(s))
      .catch((e: Error) => {
        if (!alive) return;
        toast.error("Could not load sellers", { description: e.message });
        setSellers([]);
      });
    return () => {
      alive = false;
    };
  }, [product]);

  return (
    <Sheet open={!!product} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl">
        {product ? (
          <>
            <SheetHeader className="text-left">
              <SheetTitle>{product.name}</SheetTitle>
              <SheetDescription>
                {peso(product.price)} · {product.shopName}. Pick an authorized seller — the voucher
                is bought immediately on their storefront with your Universe wallet.
              </SheetDescription>
            </SheetHeader>
            <p className="mt-4 mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Users className="size-3.5" /> Choose a seller
            </p>
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
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
