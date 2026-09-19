import { createFileRoute } from "@tanstack/react-router";
import { UniverseShell } from "@/components/universe/universe-shell";
import { LoanCenter } from "@/components/wallet/loan-center";

export const Route = createFileRoute("/universe/loans")({
  head: () => ({
    meta: [
      { title: "Loan Center — ONE WAVE Universe" },
      {
        name: "description",
        content:
          "Borrow coins, see exactly what you owe, repay, and follow every loan movement in one place.",
      },
      { property: "og:title", content: "Loan Center — ONE WAVE Universe" },
      {
        property: "og:description",
        content:
          "Your borrowing capacity, outstanding balance, interest and repayments — the same figures in the app and on the web.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: UniverseLoans,
});

function UniverseLoans() {
  return (
    <UniverseShell title="Loan Center" subtitle="Borrow, repay and track what you owe">
      <div className="px-4 sm:px-0">
        <LoanCenter />
      </div>
    </UniverseShell>
  );
}
