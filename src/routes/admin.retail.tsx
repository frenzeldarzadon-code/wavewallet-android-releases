import { createFileRoute } from "@tanstack/react-router";
import { StoreSettingsCard } from "@/components/retail/store-settings-card";
import { DeliverySettingsCard } from "@/components/retail/delivery-settings-card";
import { RetailProductsCard } from "@/components/retail/retail-products-card";
import { ShopTypeGate } from "@/components/shop/shop-type-gate";
import { useSession } from "@/lib/session";

export const Route = createFileRoute("/admin/retail")({
  head: () => ({
    meta: [
      { title: "Retail Products — WaveWallet Admin" },
      {
        name: "description",
        content:
          "Manage retail products, photos, prices and stock, plus how customers pay and receive orders — all isolated to your shop.",
      },
      { property: "og:title", content: "Retail Products — WaveWallet Admin" },
      {
        property: "og:description",
        content: "Retail inventory and fulfilment settings for your Universe Retail shop.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminRetail,
});

function AdminRetail() {
  const { ecosystemDbId } = useSession("admin");
  return (
    <ShopTypeGate ecosystemId={ecosystemDbId} requires="retail">
      <RetailProductsCard ecosystemId={ecosystemDbId} />
      <StoreSettingsCard ecosystemId={ecosystemDbId} />
      <DeliverySettingsCard ecosystemId={ecosystemDbId} />
    </ShopTypeGate>
  );
}
