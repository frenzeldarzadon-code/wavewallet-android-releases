import { createFileRoute } from "@tanstack/react-router";
import { StoreSettingsCard } from "@/components/retail/store-settings-card";
import { DeliverySettingsCard } from "@/components/retail/delivery-settings-card";
import { RetailProductsCard } from "@/components/retail/retail-products-card";
import { useSession } from "@/lib/session";

export const Route = createFileRoute("/admin/retail")({
  head: () => ({
    meta: [
      { title: "Retail Products — WaveWallet Admin" },
      {
        name: "description",
        content:
          "Choose which stores your shop runs and manage retail products, photos, prices and stock — all isolated to your shop.",
      },
      { property: "og:title", content: "Retail Products — WaveWallet Admin" },
      {
        property: "og:description",
        content: "Store configuration and retail inventory for your shop.",
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
    <>
      <StoreSettingsCard ecosystemId={ecosystemDbId} />
      <DeliverySettingsCard ecosystemId={ecosystemDbId} />
      <RetailProductsCard ecosystemId={ecosystemDbId} />
    </>
  );
}
