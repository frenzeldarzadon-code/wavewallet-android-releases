import { createFileRoute } from "@tanstack/react-router";
import { WalletCenter } from "@/components/wallet/wallet-center";

export const Route = createFileRoute("/reseller/wallet")({
  head: () => ({
    meta: [
      { title: "Wallet Center — WaveWallet Reseller" },
      { name: "description", content: "Balances per shop, transaction history, coin transfers and shop-to-shop moves in one screen." },
      { property: "og:title", content: "Wallet Center — WaveWallet Reseller" },
      { property: "og:description", content: "Balances per shop, transaction history, coin transfers and shop-to-shop moves in one screen." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResellerWallet,
});

function ResellerWallet() {
  return <WalletCenter base="/reseller" showSellerTotals />;
}
