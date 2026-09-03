import { createFileRoute } from "@tanstack/react-router";
import { OperatorAuditPanel } from "@/components/operator-audit-panel";
import { useSession } from "@/lib/session";

export const Route = createFileRoute("/super/operator-log")({
  head: () => ({
    meta: [
      { title: "Operator actions — ONE WAVE Super Admin" },
      {
        name: "description",
        content: "Platform-wide audit of every action taken while accessing a member's account.",
      },
      { property: "og:title", content: "Operator actions — ONE WAVE Super Admin" },
      {
        property: "og:description",
        content: "Platform-wide audit of every action taken while accessing a member's account.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SuperOperatorLog,
});

function SuperOperatorLog() {
  useSession("super_admin");
  return <OperatorAuditPanel ecosystemId={null} scope="platform" />;
}
