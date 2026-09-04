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
import { useShopType } from "@/lib/shop-type";
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
  const type = useShopType(ecosystemDbId);
  if (!ecosystem) return null;
  return (
    <>
      <ShopBrandingCard ecosystemId={ecosystemDbId} shopName={ecosystem.name} />
      {type && showsRetailTools(type) ? <StorefrontSettingsCard ecosystemId={ecosystemDbId} /> : null}
    </>
  );
}
