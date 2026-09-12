import { createFileRoute } from "@tanstack/react-router";
import { LegacyWalletRedirect } from "@/components/wallet/legacy-wallet-redirect";
import { DevSlot } from "@/components/dev/dev-slot";

export const Route = createFileRoute("/app/")({
  head: () => ({
    meta: [
      { title: "My Wallet — ONE WAVE" },
      { name: "description", content: "Your personal wallet now lives in Universe → My Wallet: balances, history, transfers, cash in and cash out." },
      { property: "og:title", content: "My Wallet — ONE WAVE" },
      { property: "og:description", content: "Your personal wallet now lives in Universe → My Wallet: balances, history, transfers, cash in and cash out." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CustomerWallet,
});

function CustomerWallet() {
  return (
    <DevSlot name="wallet.center">
      <LegacyWalletRedirect base="/app" />
    </DevSlot>
  );
}
