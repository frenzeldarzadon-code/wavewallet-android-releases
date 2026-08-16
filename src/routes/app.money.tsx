import { createFileRoute } from "@tanstack/react-router";
import { MoneyPage } from "@/components/money/money-page";

export const Route = createFileRoute("/app/money")({
  head: () => ({
    meta: [
      { title: "Cash Out & Cash In — WaveWallet" },
      { name: "description", content: "Convert coins to cash or top up your wallet at the platform's current valuation, verified by the platform owner." },
      { property: "og:title", content: "Cash Out & Cash In — WaveWallet" },
      { property: "og:description", content: "Convert coins to cash or top up your wallet at the platform's current valuation, verified by the platform owner." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <MoneyPage />,
});
