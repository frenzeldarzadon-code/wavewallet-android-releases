import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/components/customer/wallet-page";

export const Route = createFileRoute("/reseller/wallet")({
  head: () => ({
    meta: [
      { title: "Wallet — WaveWallet Reseller" },
      { name: "description", content: "Your credit balance, points, discounts saved and cashback rewards in one place." },
      { property: "og:title", content: "Wallet — WaveWallet Reseller" },
      { property: "og:description", content: "Your credit balance, points, discounts saved and cashback rewards in one place." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResellerWallet,
});

function ResellerWallet() {
  return <WalletPage base="/reseller" showSellerTotals />;
}
