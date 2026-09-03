import { createFileRoute } from "@tanstack/react-router";
import { WalletCenter } from "@/components/wallet/wallet-center";

export const Route = createFileRoute("/admin/wallet")({
  head: () => ({
    meta: [
      { title: "My Wallet — ONE WAVE Admin" },
      { name: "description", content: "Your personal shop wallets, transaction history, transfers and shop-to-shop moves in one screen." },
      { property: "og:title", content: "My Wallet — ONE WAVE Admin" },
      { property: "og:description", content: "Your personal shop wallets, transaction history, transfers and shop-to-shop moves in one screen." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminWallet,
});

function AdminWallet() {
  return <WalletCenter base="/admin" />;
}
