import { createFileRoute } from "@tanstack/react-router";
import { MembersDirectory } from "@/components/super/members-directory";

export const Route = createFileRoute("/super/members")({
  head: () => ({
    meta: [
      { title: "Shop Members — WaveWallet Super Admin" },
      { name: "description", content: "Browse every account across all shops with balances, roles, account access and manual credit." },
      { property: "og:title", content: "Shop Members — WaveWallet Super Admin" },
      { property: "og:description", content: "Browse every account across all shops with balances, roles, account access and manual credit." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SuperMembers,
});

function SuperMembers() {
  return <MembersDirectory />;
}
