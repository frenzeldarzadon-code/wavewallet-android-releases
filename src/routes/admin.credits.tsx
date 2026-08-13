import { createFileRoute } from "@tanstack/react-router";
import { CreditPurchasePage } from "@/components/credit-purchase-page";

export const Route = createFileRoute("/admin/credits")({
  head: () => ({
    meta: [
      { title: "Shop Credit Allocation — WaveWallet Admin" },
      {
        name: "description",
        content:
          "Request a credit allocation for your shop wallet at the configured base rate, submit the GCash reference and track verification status.",
      },
      { property: "og:title", content: "Shop Credit Allocation — WaveWallet Admin" },
      {
        property: "og:description",
        content: "Request shop credits and track verification status.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CreditPurchasePage,
});
