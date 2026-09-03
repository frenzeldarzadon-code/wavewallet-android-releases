import { createFileRoute } from "@tanstack/react-router";
import { WalletCenter } from "@/components/wallet/wallet-center";
import { DevSlot } from "@/components/dev/dev-slot";

export const Route = createFileRoute("/app/")({
  head: () => ({
    meta: [
      { title: "Wallet Center — ONE WAVE" },
      { name: "description", content: "All your shop wallets, transaction history, coin transfers and shop-to-shop moves in one screen." },
      { property: "og:title", content: "Wallet Center — ONE WAVE" },
      { property: "og:description", content: "All your shop wallets, transaction history, coin transfers and shop-to-shop moves in one screen." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CustomerWallet,
});

function CustomerWallet() {
  return (
    <DevSlot name="wallet.center">
      <WalletCenter base="/app" />
    </DevSlot>
  );
}
