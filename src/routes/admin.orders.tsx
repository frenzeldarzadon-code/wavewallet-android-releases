import { createFileRoute } from "@tanstack/react-router";
import { RetailOrdersPanel } from "@/components/retail/retail-orders-panel";
import { useSession } from "@/lib/session";

export const Route = createFileRoute("/admin/orders")({
  head: () => ({
    meta: [
      { title: "Retail Orders — WaveWallet Admin" },
      {
        name: "description",
        content:
          "Approve or reject retail orders. Stock is reserved when an order is placed and returned in full when you reject it.",
      },
      { property: "og:title", content: "Retail Orders — WaveWallet Admin" },
      {
        property: "og:description",
        content: "Review pending retail orders for your shop.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminOrders,
});

function AdminOrders() {
  const { ecosystemDbId } = useSession("admin");
  return <RetailOrdersPanel ecosystemId={ecosystemDbId} />;
}
