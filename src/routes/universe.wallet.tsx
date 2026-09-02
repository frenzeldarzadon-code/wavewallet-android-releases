import { createFileRoute } from "@tanstack/react-router";
import { UniverseShell } from "@/components/universe/universe-shell";
import { WalletCenter } from "@/components/wallet/wallet-center";

export const Route = createFileRoute("/universe/wallet")({
  head: () => ({
    meta: [
      { title: "Wallet Center — WaveWallet Universe" },
      {
        name: "description",
        content:
          "Your one global Universe wallet: balance, transfers and full transaction history.",
      },
      { property: "og:title", content: "Wallet Center — WaveWallet Universe" },
      {
        property: "og:description",
        content: "Global Universe wallet balance, transfers and history.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: UniverseWallet,
});

function UniverseWallet() {
  return (
    <UniverseShell title="Wallet Center" subtitle="Your global Universe wallet">
      <div className="px-4 sm:px-0">
        <WalletCenter base="/universe" scope="universe" />
      </div>
    </UniverseShell>
  );
}
