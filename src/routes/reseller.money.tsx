import { createFileRoute } from "@tanstack/react-router";
import { LegacyWalletRedirect } from "@/components/wallet/legacy-wallet-redirect";

export const Route = createFileRoute("/reseller/money")({
  head: () => ({
    meta: [
      { title: "Cash Out & Cash In — ONE WAVE Reseller" },
      { name: "description", content: "Turn earned coins into cash or top up your reseller wallet at the platform's current valuation." },
      { property: "og:title", content: "Cash Out & Cash In — ONE WAVE Reseller" },
      { property: "og:description", content: "Turn earned coins into cash or top up your reseller wallet at the platform's current valuation." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <LegacyWalletRedirect base="/reseller" fallback="money" />,
});
