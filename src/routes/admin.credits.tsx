import { createFileRoute } from "@tanstack/react-router";
import { CreditPurchasePage } from "@/components/credit-purchase-page";

export const Route = createFileRoute("/admin/credits")({
  head: () => ({
    meta: [
      { title: "Buy Credits — WaveWallet Admin" },
      {
        name: "description",
        content:
          "Buy a platform credit allocation for your shop, submit the GCash reference and track verification status.",
      },
      { property: "og:title", content: "Buy Credits — WaveWallet Admin" },
      {
        property: "og:description",
        content: "Purchase platform credits and track verification status.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CreditPurchasePage,
});
