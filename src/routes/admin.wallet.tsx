import { createFileRoute } from "@tanstack/react-router";
import { LegacyWalletRedirect } from "@/components/wallet/legacy-wallet-redirect";

export const Route = createFileRoute("/admin/wallet")({
  head: () => ({
    meta: [
      { title: "My Wallet — ONE WAVE Admin" },
      { name: "description", content: "Your personal wallet now lives in Universe → My Wallet. Managing other members' wallets stays in Admin → Wallets." },
      { property: "og:title", content: "My Wallet — ONE WAVE Admin" },
      { property: "og:description", content: "Your personal wallet now lives in Universe → My Wallet. Managing other members' wallets stays in Admin → Wallets." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminWallet,
});

function AdminWallet() {
  return <LegacyWalletRedirect base="/admin" />;
}
