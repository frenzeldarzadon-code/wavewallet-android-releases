import { createFileRoute } from "@tanstack/react-router";
import { TransferPage } from "@/components/customer/transfer-page";

export const Route = createFileRoute("/app/transfer")({
  head: () => ({
    meta: [
      { title: "Transfer Credits — WaveWallet" },
      { name: "description", content: "Send shop credits to another member by name, social handle, email or phone." },
      { property: "og:title", content: "Transfer Credits — WaveWallet" },
      { property: "og:description", content: "Send shop credits to another member by name, social handle, email or phone." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CustomerTransfer,
});

function CustomerTransfer() {
  return <TransferPage />;
}
