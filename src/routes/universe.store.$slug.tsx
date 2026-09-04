/**
 * Universe → Retail store of ONE shop.
 *
 * Universe is the customer portal: any signed-in Universe member can browse a
 * public Universe shop and buy its Retail products with their single global
 * Universe Wallet — no shop membership, join or approval. The database
 * (`retail_place_order`) re-checks availability, pricing, stock and payment
 * rules on every order, so this page only decides what to show.
 */
import { Link, createFileRoute, useParams } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { RetailStoreView } from "@/components/retail/retail-store-view";
import { EmptyState } from "@/components/ui-kit";
import { UniverseShell } from "@/components/universe/universe-shell";
import { fetchPublicShop, type PublicShop } from "@/lib/shop-public";

export const Route = createFileRoute("/universe/store/$slug")({
  validateSearch: (search: Record<string, unknown>): { product?: string | undefined } => ({
    product:
      typeof search["product"] === "string" && search["product"] ? search["product"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Retail Store — ONE WAVE Universe" },
      {
        name: "description",
        content:
          "Buy Retail products from any ONE WAVE Universe shop with your Universe Wallet — pickup or delivery, no shop membership needed.",
      },
      { property: "og:title", content: "Retail Store — ONE WAVE Universe" },
      {
        property: "og:description",
        content: "Order physical goods from a Universe shop straight from the customer portal.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: UniverseStore,
});

function UniverseStore() {
  const { slug } = useParams({ from: "/universe/store/$slug" });
  const { product } = Route.useSearch();
  const [shop, setShop] = useState<PublicShop | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    setShop(undefined);
    fetchPublicShop(slug)
      .then((s) => alive && setShop(s))
      .catch(() => alive && setShop(null));
    return () => {
      alive = false;
    };
  }, [slug]);

  const open = !!shop && shop.retail_enabled && shop.storefront_public;

  return (
    <UniverseShell
      title={shop ? `${shop.name} · Retail` : "Retail store"}
      subtitle="Paid from your Universe Wallet — no shop membership needed"
    >
      <div className="space-y-3 px-4 sm:px-0">
        <Link
          to="/shop/$slug"
          params={{ slug }}
          className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-2 hover:underline"
        >
          <ArrowLeft className="size-3.5" /> Shop page
        </Link>
        {shop === undefined ? null : !open ? (
          <EmptyState
            title="This shop's retail store is not open"
            description="The shop has no public retail store right now. Check back later or browse other Universe shops."
          />
        ) : (
          <RetailStoreView
            shop={{
              id: shop.id,
              name: shop.name,
              description: shop.description,
              productId: product ?? null,
            }}
          />
        )}
      </div>
    </UniverseShell>
  );
}
