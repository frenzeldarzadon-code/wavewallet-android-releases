import { createFileRoute } from "@tanstack/react-router";
import { HistoryPage } from "@/components/customer/history-page";

export const Route = createFileRoute("/reseller/history")({
  head: () => ({
    meta: [
      { title: "Transaction History — WaveWallet Reseller" },
      { name: "description", content: "Every credit movement, voucher purchase, transfer and reward in one categorized history." },
      { property: "og:title", content: "Transaction History — WaveWallet Reseller" },
      { property: "og:description", content: "Every credit movement, voucher purchase, transfer and reward in one categorized history." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResellerHistory,
});

function ResellerHistory() {
  return <HistoryPage />;
}
