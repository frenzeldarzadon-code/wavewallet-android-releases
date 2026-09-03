import { createFileRoute } from "@tanstack/react-router";
import { RetailStoreView } from "@/components/retail/retail-store-view";

export const Route = createFileRoute("/app/store")({
  head: () => ({
    meta: [
      { title: "Retail Store — ONE WAVE" },
      {
        name: "description",
        content:
          "Browse your shop's physical goods, add several items to one cart and choose pickup or delivery. Orders stay pending until the shop approves them.",
      },
      { property: "og:title", content: "Retail Store — ONE WAVE" },
      {
        property: "og:description",
        content: "Order physical goods from your shop with pickup or delivery.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <RetailStoreView role="customer" />,
});
