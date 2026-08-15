import { createFileRoute } from "@tanstack/react-router";
import { ManualCreditCard } from "@/components/super/manual-credit-card";

export const Route = createFileRoute("/super/credits")({
  head: () => ({
    meta: [
      { title: "Credit Management — WaveWallet Super Admin" },
      {
        name: "description",
        content:
          "Mint or remove credits in any WaveWallet shop from the platform console, with a full audit trail.",
      },
      { property: "og:title", content: "Credit Management — WaveWallet Super Admin" },
      {
        property: "og:description",
        content:
          "Issue or remove audited manual credits in any shop.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SuperCredits,
});

function SuperCredits() {
  return <ManualCreditCard />;
}
