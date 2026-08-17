import { createFileRoute } from "@tanstack/react-router";
import { ApplicationsPanel } from "@/components/applications-panel";
import { MemberInboxPanel } from "@/components/member-inbox-panel";
import { useSession } from "@/lib/session";

export const Route = createFileRoute("/admin/applications")({
  head: () => ({
    meta: [
      { title: "New Members — WaveWallet Admin" },
      {
        name: "description",
        content:
          "Review members who just joined your shop and keep or remove them.",
      },
      { property: "og:title", content: "New Members — WaveWallet Admin" },
      {
        property: "og:description",
        content: "Keep or remove members who joined your shop automatically.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminApplications,
});

function AdminApplications() {
  const { ecosystemDbId } = useSession("admin");
  return (
    <>
      <MemberInboxPanel />
      <ApplicationsPanel
        ecosystemId={ecosystemDbId}
        description="Members who joined your shop automatically. They are already active — keep or remove them."
      />
    </>
  );
}
