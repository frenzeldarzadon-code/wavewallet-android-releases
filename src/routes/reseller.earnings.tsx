import { createFileRoute } from "@tanstack/react-router";
import { EarningsHistory } from "@/components/earnings-history";
import { useSession } from "@/lib/session";
import { roleLabel } from "@/lib/wavewallet";

export const Route = createFileRoute("/reseller/earnings")({
  head: () => ({
    meta: [
      { title: "Earnings History — WaveWallet Reseller" },
      {
        name: "description",
        content:
          "Every commission, cashback and wholesale margin you earned, with daily, monthly, quarterly and yearly totals, filters and CSV export.",
      },
      { property: "og:title", content: "Earnings History — WaveWallet Reseller" },
      {
        property: "og:description",
        content: "Transaction-level earnings history with period summaries and CSV export.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResellerEarnings,
});

function ResellerEarnings() {
  const { account } = useSession("reseller");
  if (!account) return null;
  return (
    <EarningsHistory
      recipientId={account.id}
      title={`Earnings history · ${roleLabel(account.role)}`}
      description="Only your own earnings. Sales cashback on credits you funded, upline commission from your downline's sales, and wholesale margin on your own purchases. Credit transfers are face value and never counted."
    />
  );
}
