import { createFileRoute } from "@tanstack/react-router";
import { LegacyWalletRedirect } from "@/components/wallet/legacy-wallet-redirect";

export const Route = createFileRoute("/reseller/wallet")({
  head: () => ({
    meta: [
      { title: "My Wallet — ONE WAVE Reseller" },
      { name: "description", content: "Your personal wallet now lives in Universe → My Wallet: balances, history, transfers, cash in and cash out." },
      { property: "og:title", content: "My Wallet — ONE WAVE Reseller" },
      { property: "og:description", content: "Your personal wallet now lives in Universe → My Wallet: balances, history, transfers, cash in and cash out." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResellerWallet,
});

function ResellerWallet() {
  return <LegacyWalletRedirect base="/reseller" showSellerTotals />;
}
