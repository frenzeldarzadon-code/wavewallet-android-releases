/**
 * Public storefront for one shop.
 *
 * A visitor sees only what the shop chose to publish: public products, public
 * ratings and public contact details. Prices, stock and reviews shown here come
 * from that shop alone — there is no path from this page to another shop's
 * members, wallets, orders or voucher codes.
 */
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Loader2, MapPin, Store, Ticket, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, PageSection, StatusBadge } from "@/components/ui-kit";
import { RatingStars } from "@/components/rating-stars";
import { RetailImage } from "@/components/retail/retail-image";
import { VoucherArtwork } from "@/components/universe/voucher-artwork";
import { SellerCard } from "@/components/universe/universe-shop-discovery";
import {
  MarketplaceEmpty,
  MarketplaceHeader,
  ProductCard,
  ProductDetailSheet,
  productGridClass,
} from "@/components/retail/marketplace";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { DEFAULT_STORE_SETTINGS, type RetailProduct } from "@/lib/retail";
import { matchesSearch, useDebouncedValue } from "@/lib/retail-catalog";
import { RETAIL_VISIBLE } from "@/lib/features";
import { shortDateTime } from "@/lib/wavewallet";
import { supabase } from "@/integrations/supabase/client";
import { fetchUniverseSellers, type ShopSeller } from "@/lib/seller-storefront";
import {
  fetchPublicProducts,
  fetchPublicReviews,
  fetchPublicShop,
  visitorAction,
  type PublicProduct,
  type PublicReview,
  type PublicShop,
} from "@/lib/shop-public";

export const Route = createFileRoute("/shop/$slug")({
  head: ({ params }) => ({
    meta: [
      { title: `${params.slug} Storefront — ONE WAVE` },
      {
        name: "description",
        content:
          "Browse this ONE WAVE shop's public products, prices and customer ratings, then request to join to place an order.",
      },
      { property: "og:title", content: `${params.slug} Storefront — ONE WAVE` },
      {
        property: "og:description",
        content: "Public products, prices and ratings for this WaveWallet shop.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PublicStorefront,
});

const credits = (n: number) => `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} coins`;

function PublicStorefront() {
  const { slug } = Route.useParams();
  const navigate = useNavigate();
  const [shop, setShop] = useState<PublicShop | null>(null);
  const [products, setProducts] = useState<PublicProduct[]>([]);
  const [reviews, setReviews] = useState<PublicReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [search, setSearch] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
  // Authorized sellers of a Universe voucher shop. Buying a voucher never
  // requires shop membership: the customer picks a seller and continues into
  // the existing seller-attributed checkout. null = still loading.
  const [sellers, setSellers] = useState<ShopSeller[] | null>(null);
  const [sellerPickFor, setSellerPickFor] = useState<PublicProduct | null>(null);
  const debouncedSearch = useDebouncedValue(search);

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => setSignedIn(!!data.user));
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const s = await fetchPublicShop(slug);
        if (!alive) return;
        setShop(s);
        if (s) {
          const [p, r] = await Promise.all([fetchPublicProducts(slug), fetchPublicReviews(slug)]);
          if (!alive) return;
          setProducts(p);
          setReviews(r);
          if (s.voucher_enabled) {
            fetchUniverseSellers(slug)
              .then((list) => { if (alive) setSellers(list); })
              .catch(() => { if (alive) setSellers([]); });
          } else {
            setSellers([]);
          }
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [slug]);

  if (loading) {
    return <p className="p-6 text-sm text-muted-foreground">Loading storefront…</p>;
  }

  if (!shop || !shop.storefront_public) {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <h1 className="text-xl font-semibold">Storefront unavailable</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This shop has not published a public storefront.
        </p>
        <Button asChild className="mt-4">
          <Link to="/">Back to ONE WAVE</Link>
        </Button>
      </main>
    );
  }

  const action = visitorAction(shop, signedIn);
  // Public prices are already the customer Retail Price (fee inside, computed
  // by the database), so the cards render them with a 0 % presentation fee.
  const retail: RetailProduct[] = products
    .filter((p) => p.kind === "retail")
    .map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      image_path: p.image_path,
      price: p.price,
      stock: p.available,
      sold_count: 0,
      public_visible: true,
      rating_avg: p.rating_avg,
      rating_count: p.rating_count,
    }));
  const retailVisible = retail.filter((p) => matchesSearch(p, debouncedSearch));
  const detail = detailId ? (retail.find((p) => p.id === detailId) ?? null) : null;
  const vouchers = products.filter((p) => p.kind === "voucher");

  const cta =
    action === "open"
      ? { label: "Open your shop", onClick: () => void navigate({ to: "/app" }) }
      : action === "join"
        ? {
            label: "Request to join",
            onClick: () => void navigate({ to: "/join/$slug", params: { slug } }),
          }
        : action === "sign-in"
          ? { label: "Sign in to join", onClick: () => void navigate({ to: "/" }) }
          : null;

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4 pb-16">
      {RETAIL_VISIBLE && shop.retail_enabled ? (
        <MarketplaceHeader
          shopName={shop.name}
          description={shop.description}
          productCount={retail.length}
          logoPath={shop.logo_path}
          coverPath={shop.cover_path}
          acceptingOrders={shop.accepting_orders}
          pausedNote={shop.paused_note}
          backLink={
            <Link to="/universe/shops" className="inline-flex items-center gap-1 hover:underline">
              <ArrowLeft className="size-3.5" /> All shops
            </Link>
          }
        />
      ) : (
        <header className="rounded-2xl bg-gradient-to-br from-primary/15 to-success/10 p-5">
          <h1 className="text-2xl font-semibold">{shop.name}</h1>
          {shop.description ? (
            <p className="mt-1 text-sm text-muted-foreground">{shop.description}</p>
          ) : null}
        </header>
      )}
      <section className="rounded-2xl border border-border bg-card px-4 py-3 shadow-[var(--shadow-card)]">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <RatingStars avg={shop.rating_avg} count={shop.rating_count} />
          <span>
            {shop.rating_avg.toFixed(1)} ({shop.rating_count}) · {shop.member_count} members ·{" "}
            {shop.sales_count} sales
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {shop.voucher_enabled ? (
            <StatusBadge tone="brand">
              <Ticket className="size-3" /> Voucher store
            </StatusBadge>
          ) : null}
          {RETAIL_VISIBLE && shop.retail_enabled ? (
            <StatusBadge tone="success">
              <Store className="size-3" /> Retail store
            </StatusBadge>
          ) : null}
        </div>
        {cta ? (
          <Button className="mt-3 w-full sm:w-auto" onClick={cta.onClick}>
            {cta.label} <ArrowRight className="size-4" />
          </Button>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">
            {action === "pending"
              ? "Your request to join is waiting for the shop to review it."
              : "This shop is not accepting new members right now."}
          </p>
        )}
        {shop.contact_email || shop.contact_phone ? (
          <p className="mt-3 flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="size-3" />{" "}
            {[shop.contact_email, shop.contact_phone].filter(Boolean).join(" · ")}
          </p>
        ) : null}
      </section>

      <Tabs
        defaultValue={RETAIL_VISIBLE && (retail.length || !vouchers.length) ? "retail" : "voucher"}
      >
        <TabsList className="w-full">
          {RETAIL_VISIBLE ? (
            <TabsTrigger value="retail" className="flex-1">
              Retail ({retail.length})
            </TabsTrigger>
          ) : null}
          <TabsTrigger value="voucher" className="flex-1">
            Vouchers ({vouchers.length})
          </TabsTrigger>
          <TabsTrigger value="reviews" className="flex-1">
            Reviews ({reviews.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="retail" hidden={!RETAIL_VISIBLE}>
          {retail.length === 0 ? (
            <MarketplaceEmpty
              filtered={false}
              hint="This shop has not published any retail products publicly yet."
            />
          ) : (
            <div className="space-y-3">
              <label className="relative block">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search products…"
                  aria-label="Search products"
                  className="h-11 rounded-2xl pl-9"
                />
              </label>
              {retailVisible.length === 0 ? (
                <MarketplaceEmpty filtered onClear={() => setSearch("")} />
              ) : (
                <div className={productGridClass}>
                  {retailVisible.map((p) => (
                    <ProductCard
                      key={p.id}
                      product={p}
                      feePercent={0}
                      quantity={0}
                      onOpen={() => setDetailId(p.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
          <ProductDetailSheet
            product={detail}
            feePercent={0}
            settings={{ ...DEFAULT_STORE_SETTINGS, pickupEnabled: false, deliveryEnabled: false }}
            shopName={shop.name}
            quantity={0}
            onChange={() => undefined}
            onClose={() => setDetailId(null)}
            onBuyNow={() => undefined}
            footer={
              <div className="flex w-full items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  {cta ? "Join this shop to order." : "Ordering is for shop members."}
                </p>
                {cta ? (
                  <Button onClick={cta.onClick}>
                    {cta.label} <ArrowRight className="size-4" />
                  </Button>
                ) : null}
              </div>
            }
          />
        </TabsContent>

        <TabsContent value="voucher" className="space-y-4">
          {/* Sellers first: buying a voucher never requires joining the shop. */}
          <section
            id="sellers"
            className="rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-card)]"
            aria-label="Authorized sellers"
          >
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
            <p className="mb-3 text-xs text-muted-foreground">
              No shop membership needed — pick a seller and pay with your Universe coins.
            </p>
            {sellers === null ? (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" /> Loading sellers…
              </p>
            ) : sellers.length === 0 ? (
              <EmptyState
                title="No seller available right now"
                description="This shop has no authorized seller taking Universe orders at the moment. Check back later."
              />
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {sellers.map((s) => (
                  <li key={s.sellerId}>
                    <SellerCard seller={s} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {vouchers.length === 0 ? (
            <EmptyState title="No public voucher products" />
          ) : (
            <PageSection title="Voucher products">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {vouchers.map((v) => {
                  const soldOut = v.available <= 0;
                  const noSeller = sellers !== null && sellers.length === 0;
                  return (
                  <Card key={v.id} className="min-w-0 overflow-hidden rounded-xl shadow-[var(--shadow-card)]">
                    {v.image_path ? (
                      <RetailImage path={v.image_path} alt={v.name} className="aspect-[16/10]" />
                    ) : (
                      <VoucherArtwork seed={`${shop.id}-${v.id}`} name={v.name} compact />
                    )}
                    <CardContent className="space-y-2 p-3">
                      <div className="min-w-0">
                        <p className="line-clamp-2 min-h-10 text-sm font-semibold leading-snug">{v.name}</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {soldOut ? "Sold out" : `${v.available} available`}
                        </p>
                      </div>
                      <p className="text-sm font-bold text-primary">{credits(v.price)}</p>
                      {sellers && sellers.length === 1 ? (
                        <Button asChild className="w-full" size="sm" variant="outline">
                          <Link to="/universe/u/$handle" params={{ handle: sellers[0]!.sellerHandle }}>
                            Buy from {sellers[0]!.sellerName.split(" ")[0]} <ArrowRight className="size-3.5" />
                          </Link>
                        </Button>
                      ) : (
                        <Button
                          className="w-full"
                          size="sm"
                          variant="outline"
                          disabled={sellers === null || noSeller}
                          onClick={() => setSellerPickFor(v)}
                        >
                          {noSeller ? "No seller available" : "Choose a seller"} <ArrowRight className="size-3.5" />
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                  );
                })}
              </div>
            </PageSection>
          )}

          <Dialog open={sellerPickFor !== null} onOpenChange={(o) => { if (!o) setSellerPickFor(null); }}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Choose a seller</DialogTitle>
                <DialogDescription>
                  {sellerPickFor ? `Buy "${sellerPickFor.name}" from one of ${shop.name}'s authorized sellers. ` : ""}
                  Same price, paid with your Universe coins — no membership needed.
                </DialogDescription>
              </DialogHeader>
              <ul className="grid gap-2">
                {(sellers ?? []).map((s) => (
                  <li key={s.sellerId} onClick={() => setSellerPickFor(null)}>
                    <SellerCard seller={s} />
                  </li>
                ))}
              </ul>
            </DialogContent>
          </Dialog>
        </TabsContent>

        <TabsContent value="reviews">
          {reviews.length === 0 ? (
            <EmptyState title="No reviews yet" />
          ) : (
            <Card className="shadow-[var(--shadow-card)]">
              <CardContent className="divide-y divide-border px-0 py-0">
                {reviews.map((r) => (
                  <div key={r.id} className="space-y-1 px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">{r.author_name}</p>
                      <RatingStars avg={r.rating} count={null} />
                    </div>
                    {r.comment ? (
                      <p className="text-xs text-muted-foreground">{r.comment}</p>
                    ) : null}
                    <p className="text-[11px] text-muted-foreground">
                      {shortDateTime(r.created_at)}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </main>
  );
}
