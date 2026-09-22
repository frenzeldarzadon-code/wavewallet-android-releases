import { createFileRoute } from "@tanstack/react-router";
import { UniverseShell } from "@/components/universe/universe-shell";
import { LoanCenter } from "@/components/wallet/loan-center";
import { UniverseLoanCenter } from "@/components/wallet/universe-loan-center";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/universe/loans")({
  head: () => ({
    meta: [
      { title: "Loan Center — ONE WAVE Universe" },
      {
        name: "description",
        content:
          "Apply for peer-funded Universe Loans, review reducing-balance payments, and keep existing Shop Loans in one place.",
      },
      { property: "og:title", content: "Loan Center — ONE WAVE Universe" },
      {
        property: "og:description",
        content:
          "Peer-funded Universe Loans and existing Shop Loans with clear schedules, balances and repayments.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: UniverseLoans,
});

function UniverseLoans() {
  return (
    <UniverseShell title="Loan Center" subtitle="Universe Loans and Shop Loans">
      <div className="px-4 sm:px-0">
        <Tabs defaultValue="universe">
          <TabsList className="mx-0 grid w-full grid-cols-2">
            <TabsTrigger value="universe">Universe Loan</TabsTrigger>
            <TabsTrigger value="shop">Shop Loan</TabsTrigger>
          </TabsList>
          <TabsContent value="universe"><UniverseLoanCenter /></TabsContent>
          <TabsContent value="shop"><LoanCenter /></TabsContent>
        </Tabs>
      </div>
    </UniverseShell>
  );
}
