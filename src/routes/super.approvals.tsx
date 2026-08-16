import { createFileRoute } from "@tanstack/react-router";
import { ApplicationsPanel } from "@/components/applications-panel";
import { CreditRequestsCard } from "@/components/super/credit-requests-card";
import { MoneyRequestsCard } from "@/components/super/money-requests-card";
import { ReferenceConflictsCard } from "@/components/super/reference-conflicts-card";
import { useSession } from "@/lib/session";

export const Route = createFileRoute("/super/approvals")({
  head: () => ({
    meta: [
      { title: "Approvals — WaveWallet Super Admin" },
      { name: "description", content: "Every pending platform approval in one place: shop coin payments and self-service signup applications." },
      { property: "og:title", content: "Approvals — WaveWallet Super Admin" },
      { property: "og:description", content: "Every pending platform approval in one place: shop coin payments and self-service signup applications." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SuperApprovals,
});

function SuperApprovals() {
  const session = useSession("super_admin");
  if (!session.account) return null;
  return (
    <>
      <CreditRequestsCard />
      <MoneyRequestsCard />
      <ReferenceConflictsCard />
      <ApplicationsPanel
        ecosystemId={null}
        showEcosystem
        title="Signup applications"
        description="Every self-service signup across the platform, with the shop each applicant chose."
      />
    </>
  );
}
