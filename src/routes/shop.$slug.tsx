/**
 * Public storefront for one shop.
 *
 * A visitor sees only what the shop chose to publish: public products, public
 * ratings and public contact details. Prices, stock and reviews shown here come
 * from that shop alone — there is no path from this page to another shop's
 * members, wallets, orders or voucher codes.
 */
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowRight, MapPin, Store, Ticket } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, PageSection, StatusBadge } from "@/components/ui-kit";
import { RatingStars } from "@/components/rating-stars";
import {
  MarketplaceEmpty,
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
      { title: `${params.slug} Storefront — WaveWallet` },
      {
        name: "description",
        content:
          "Browse this WaveWallet shop's public products, prices and customer ratings, then request to join to place an order.",
      },
      { property: "og:title", content: `${params.slug} Storefront — WaveWallet` },
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
          <Link to="/">Back to WaveWallet</Link>
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
      <header className="rounded-2xl bg-gradient-to-br from-primary/15 to-success/10 p-5">
        <h1 className="text-2xl font-semibold">{shop.name}</h1>
        {shop.description ? (
          <p className="mt-1 text-sm text-muted-foreground">{shop.description}</p>
        ) : null}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <RatingStars avg={shop.rating_avg} count={shop.rating_count} />
          <span>
            {shop.rating_avg.toFixed(1)} ({shop.rating_count}) · {shop.member_count} members ·{" "}
            {shop.sales_count} sales
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
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
          <Button className="mt-4 w-full sm:w-auto" onClick={cta.onClick}>
            {cta.label} <ArrowRight className="size-4" />
          </Button>
        ) : (
          <p className="mt-4 text-xs text-muted-foreground">
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
      </header>

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

        <TabsContent value="voucher">
          {vouchers.length === 0 ? (
            <EmptyState title="No public voucher products" />
          ) : (
            <PageSection title="Voucher products">
              <Card className="shadow-[var(--shadow-card)]">
                <CardContent className="divide-y divide-border px-0 py-0">
                  {vouchers.map((v) => (
                    <div key={v.id} className="flex items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{v.name}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {v.available > 0 ? `${v.available} available` : "Sold out"}
                        </p>
                      </div>
                      <p className="text-sm font-semibold">{credits(v.price)}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </PageSection>
          )}
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
