import { createFileRoute } from "@tanstack/react-router";
import { ApplicationsPanel } from "@/components/applications-panel";
import { MemberInboxPanel } from "@/components/member-inbox-panel";
import { useSession } from "@/lib/session";

export const Route = createFileRoute("/reseller/applications")({
  head: () => ({
    meta: [
      { title: "New Members — WaveWallet Reseller" },
      {
        name: "description",
        content:
          "Review members who just joined your shop and keep or remove them.",
      },
      { property: "og:title", content: "New Members — WaveWallet Reseller" },
      {
        property: "og:description",
        content: "Keep or remove members who joined your shop automatically.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResellerApplications,
});

function ResellerApplications() {
  const { ecosystemDbId } = useSession("reseller");
  return (
    <>
      <MemberInboxPanel />
      <ApplicationsPanel
        ecosystemId={ecosystemDbId}
        description="Members who joined this shop automatically. They are already active — keep or remove them."
      />
    </>
  );
}
