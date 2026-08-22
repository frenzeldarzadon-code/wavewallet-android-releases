import { createFileRoute } from "@tanstack/react-router";
import { SpendingTrackerPage } from "@/components/spending/spending-tracker-page";
import { useSession } from "@/lib/session";

export const Route = createFileRoute("/admin/spending")({
  head: () => ({
    meta: [
      { title: "Spending Tracker — WaveWallet Admin" },
      {
        name: "description",
        content:
          "Track your shop's income and expenses: cashback earned per reseller, admin discounts, admin purchases and your own manual entries.",
      },
      { property: "og:title", content: "Spending Tracker — WaveWallet Admin" },
      {
        property: "og:description",
        content:
          "Shop-scoped income and expense analytics with per-reseller cashback attribution, admin discounts and manual entries.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminSpending,
});

function AdminSpending() {
  const { ecosystemDbId } = useSession("admin");
  return <SpendingTrackerPage ecosystemId={ecosystemDbId ?? null} />;
}
