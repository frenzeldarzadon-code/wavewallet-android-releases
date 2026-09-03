import { createFileRoute } from "@tanstack/react-router";
import { ManualCreditCard } from "@/components/super/manual-credit-card";

export const Route = createFileRoute("/super/credits")({
  head: () => ({
    meta: [
      { title: "Coin Management — ONE WAVE Super Admin" },
      {
        name: "description",
        content:
          "Mint or remove coins in any ONE WAVE shop from the platform console, with a full audit trail.",
      },
      { property: "og:title", content: "Coin Management — ONE WAVE Super Admin" },
      {
        property: "og:description",
        content:
          "Issue or remove audited manual coins in any shop.",
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
