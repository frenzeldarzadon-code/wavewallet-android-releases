import { createFileRoute } from "@tanstack/react-router";
import { WalletCenter } from "@/components/wallet/wallet-center";

export const Route = createFileRoute("/app/")({
  head: () => ({
    meta: [
      { title: "Wallet Center — WaveWallet" },
      { name: "description", content: "All your shop wallets, transaction history, credit transfers and shop-to-shop moves in one screen." },
      { property: "og:title", content: "Wallet Center — WaveWallet" },
      { property: "og:description", content: "All your shop wallets, transaction history, credit transfers and shop-to-shop moves in one screen." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CustomerWallet,
});

function CustomerWallet() {
  return <WalletCenter base="/app" />;
}
