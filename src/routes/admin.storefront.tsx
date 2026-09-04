/**
 * Storefront design — how this shop looks to customers in Universe and on its
 * public storefront. One place for the existing branding tools (logo, cover,
 * theme, open/paused state); shop name, description and contact details stay
 * in Shop settings. Presentation only: no prices, fees or wallet logic here.
 */
import { createFileRoute } from "@tanstack/react-router";
import { ShopBrandingCard } from "@/components/shop/shop-branding-card";
import { StorefrontSettingsCard } from "@/components/retail/storefront-settings-card";
import { useSession } from "@/lib/session";
import { useShopStatus } from "@/lib/shop-status";
import { showsRetailTools } from "@/lib/shop-type";

export const Route = createFileRoute("/admin/storefront")({
  head: () => ({
    meta: [
      { title: "Storefront design — ONE WAVE Shop Dashboard" },
      {
        name: "description",
        content:
          "Design how your shop appears to Universe customers: logo, cover image, theme and whether the storefront is open for orders.",
      },
      { property: "og:title", content: "Storefront design — ONE WAVE Shop Dashboard" },
      {
        property: "og:description",
        content: "Logo, cover, theme and storefront status for your shop.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminStorefront,
});

function AdminStorefront() {
  const { ecosystemDbId, ecosystem } = useSession("admin");
  const status = useShopStatus(ecosystemDbId);
  if (!ecosystem) return null;
  // Logo / cover are saved through `update_retail_storefront`, which only
  // accepts Universe shops (shop_kind = 'universe'). New Generation and legacy
  // shops have no Universe storefront, so explain that instead of offering an
  // upload the server would reject (and leave an orphaned image behind).
  const hasUniverseStorefront = status.loading || status.shopKind === null || status.shopKind === "universe";
  return (
    <>
      {hasUniverseStorefront ? (
        <ShopBrandingCard ecosystemId={ecosystemDbId} shopName={ecosystem.name} />
      ) : (
        <PageSection title="Shop images & branding">
          <Card className="shadow-[var(--shadow-card)]">
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>
                {status.isNewGeneration
                  ? "New Generation shops stay isolated from Universe commerce, so they have no public Universe storefront to brand."
                  : "This shop has no Universe storefront, so there is no public page to show a logo or cover image on."}
              </p>
              <p>Shop name, description and contact details are edited in Shop settings.</p>
            </CardContent>
          </Card>
        </PageSection>
      )}
      {/* Retail shops also control theme and the open / paused state here. */}
      {status.shopType && showsRetailTools(status.shopType) ? (
        <StorefrontSettingsCard ecosystemId={ecosystemDbId} />
      ) : null}
    </>
  );
}
