import { createFileRoute } from "@tanstack/react-router";
import { CreditRequestsCard } from "@/components/super/credit-requests-card";
import { ManualCreditCard } from "@/components/super/manual-credit-card";

export const Route = createFileRoute("/super/credits")({
  head: () => ({
    meta: [
      { title: "Credit Management — WaveWallet Super Admin" },
      {
        name: "description",
        content:
          "Verify pending shop credit purchases and grant manual credits from the WaveWallet platform console.",
      },
      { property: "og:title", content: "Credit Management — WaveWallet Super Admin" },
      {
        property: "og:description",
        content:
          "Approve, reject or freeze admin credit purchase requests and issue audited manual credits.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SuperCredits,
});

function SuperCredits() {
  return (
    <>
      <CreditRequestsCard />
      <ManualCreditCard />
    </>
  );
}
