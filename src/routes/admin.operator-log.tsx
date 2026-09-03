import { createFileRoute } from "@tanstack/react-router";
import { OperatorAuditPanel } from "@/components/operator-audit-panel";
import { useSession } from "@/lib/session";

export const Route = createFileRoute("/admin/operator-log")({
  head: () => ({
    meta: [
      { title: "Operator actions — ONE WAVE Admin" },
      {
        name: "description",
        content:
          "Audit trail of every action taken while accessing a member's account in your shop.",
      },
      { property: "og:title", content: "Operator actions — ONE WAVE Admin" },
      {
        property: "og:description",
        content:
          "Audit trail of every action taken while accessing a member's account in your shop.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminOperatorLog,
});

function AdminOperatorLog() {
  const { ecosystemDbId } = useSession("admin");
  return <OperatorAuditPanel ecosystemId={ecosystemDbId} scope="ecosystem" />;
}
