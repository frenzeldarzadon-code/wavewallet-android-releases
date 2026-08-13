import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/components/customer/wallet-page";

export const Route = createFileRoute("/app/")({
  head: () => ({
    meta: [
      { title: "Wallet — WaveWallet" },
      { name: "description", content: "Your shop credit balance and points balance, with quick links to the shop and transfers." },
      { property: "og:title", content: "Wallet — WaveWallet" },
      { property: "og:description", content: "Your shop credit balance and points balance, with quick links to the shop and transfers." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CustomerWallet,
});

function CustomerWallet() {
  return <WalletPage base="/app" />;
}
