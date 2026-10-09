import { createFileRoute, redirect } from "@tanstack/react-router";
import { LOANS_VISIBLE } from "@/lib/features";
import { UniverseShell } from "@/components/universe/universe-shell";
import { LoanPoolCenter } from "@/components/wallet/loan-pool-center";

export const Route = createFileRoute("/universe/loan-pool")({
  beforeLoad: () => { if (!LOANS_VISIBLE) throw redirect({ to: "/universe/wallet", replace: true }); },
  head: () => ({ meta: [
    { title: "Loan Pool — ONE WAVE Universe" },
    { name: "description", content: "Contribute Universe coins, fund member loans, and track allocated principal and interest earnings." },
    { property: "og:title", content: "Loan Pool — ONE WAVE Universe" },
    { property: "og:description", content: "Contribute coins and fund peer-backed Universe Loans." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: UniverseLoanPool,
});

function UniverseLoanPool() {
  return <UniverseShell title="Loan Pool" subtitle="Contribute, fund and earn"><div className="px-4 sm:px-0"><LoanPoolCenter /></div></UniverseShell>;
}