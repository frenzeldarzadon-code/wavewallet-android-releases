import { createFileRoute } from "@tanstack/react-router";
import { RetailStoreView } from "@/components/retail/retail-store-view";

export const Route = createFileRoute("/reseller/store")({
  head: () => ({
    meta: [
      { title: "Retail Store — WaveWallet Reseller" },
      {
        name: "description",
        content:
          "Order physical goods from your shop's retail store with pickup or delivery, paid in cash or shop credits.",
      },
      { property: "og:title", content: "Retail Store — WaveWallet Reseller" },
      {
        property: "og:description",
        content: "Retail goods ordering for resellers, approved by the shop admin.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <RetailStoreView role="reseller" />,
});
