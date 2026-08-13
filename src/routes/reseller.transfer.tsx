import { createFileRoute } from "@tanstack/react-router";
import { TransferPage } from "@/components/customer/transfer-page";

export const Route = createFileRoute("/reseller/transfer")({
  head: () => ({
    meta: [
      { title: "Transfer Credits — WaveWallet Reseller" },
      { name: "description", content: "Send shop credits to a member by name, social handle, email or phone." },
      { property: "og:title", content: "Transfer Credits — WaveWallet Reseller" },
      { property: "og:description", content: "Send shop credits to a member by name, social handle, email or phone." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResellerTransfer,
});

function ResellerTransfer() {
  return <TransferPage />;
}
