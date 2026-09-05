import { createFileRoute } from "@tanstack/react-router";
import { PageSection } from "@/components/ui-kit";
import { UniverseProductFeed } from "@/components/universe/universe-product-feed";
import { UniverseShell } from "@/components/universe/universe-shell";
import { useSession } from "@/lib/session";

export const Route = createFileRoute("/universe/products")({
  head: () => ({
    meta: [
      { title: "All Products — ONE WAVE Universe" },
      {
        name: "description",
        content:
          "Browse every WiFi voucher and retail product on sale across ONE WAVE Universe shops — trending, new and personalised picks.",
      },
      { property: "og:title", content: "All Products — ONE WAVE Universe" },
      {
        property: "og:description",
        content: "Discover vouchers and retail goods from every Universe shop in one feed.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: UniverseProducts,
});

function UniverseProducts() {
  const { account } = useSession();
  return (
    <UniverseShell title="All Products" subtitle="Everything on sale across the Universe">
      <div className="px-4 sm:px-0">
        <PageSection
          title="Marketplace"
          description="Vouchers are bought instantly through a seller; retail goods go to that shop's cart. The mix learns from what people buy and open."
        >
          <UniverseProductFeed currentUserId={account?.id} />
        </PageSection>
      </div>
    </UniverseShell>
  );
}
