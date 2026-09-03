import { createFileRoute } from "@tanstack/react-router";
import { RewardsPage } from "@/components/customer/rewards-page";

export const Route = createFileRoute("/reseller/rewards")({
  head: () => ({
    meta: [
      { title: "Rewards — ONE WAVE Reseller" },
      { name: "description", content: "Redeem your points for rewards offered by your shop." },
      { property: "og:title", content: "Rewards — ONE WAVE Reseller" },
      { property: "og:description", content: "Redeem your points for rewards offered by your shop." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResellerRewards,
});

function ResellerRewards() {
  return <RewardsPage />;
}
