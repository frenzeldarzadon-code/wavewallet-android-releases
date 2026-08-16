import { createFileRoute } from "@tanstack/react-router";
import { CreditPurchasePage } from "@/components/credit-purchase-page";

export const Route = createFileRoute("/admin/coins")({
  head: () => ({
    meta: [
      { title: "Shop Coin Allocation — WaveWallet Admin" },
      {
        name: "description",
        content:
          "Request a coin allocation for your shop wallet at the configured base rate, submit the GCash reference and track verification status.",
      },
      { property: "og:title", content: "Shop Coin Allocation — WaveWallet Admin" },
      {
        property: "og:description",
        content: "Request shop coins and track verification status.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CreditPurchasePage,
});
