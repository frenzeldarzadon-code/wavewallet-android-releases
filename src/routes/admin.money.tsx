import { createFileRoute } from "@tanstack/react-router";
import { MoneyPage } from "@/components/money/money-page";

export const Route = createFileRoute("/admin/money")({
  head: () => ({
    meta: [
      { title: "Cash Out & Cash In — WaveWallet Shop Admin" },
      { name: "description", content: "Request a real-money withdrawal of shop credits or cash in through a platform payment method." },
      { property: "og:title", content: "Cash Out & Cash In — WaveWallet Shop Admin" },
      { property: "og:description", content: "Request a real-money withdrawal of shop credits or cash in through a platform payment method." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): { tab?: "in" | "out" } =>
    search["tab"] === "in" ? { tab: "in" } : search["tab"] === "out" ? { tab: "out" } : {},
  component: AdminMoney,
});

function AdminMoney() {
  const { tab } = Route.useSearch();
  return <MoneyPage initialTab={tab ?? "out"} />;
}
