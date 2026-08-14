import { createFileRoute } from "@tanstack/react-router";
import { ApplicationsPanel } from "@/components/applications-panel";
import { MemberInboxPanel } from "@/components/member-inbox-panel";
import { useSession } from "@/lib/session";

export const Route = createFileRoute("/admin/applications")({
  head: () => ({
    meta: [
      { title: "Applications & Invites — WaveWallet Admin" },
      {
        name: "description",
        content:
          "Review pending signup applications for your shop and approve or reject membership requests.",
      },
      { property: "og:title", content: "Applications & Invites — WaveWallet Admin" },
      {
        property: "og:description",
        content: "Approve or reject pending membership applications for your shop.",
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
      description="New members who chose your shop. They cannot enter until approved."
      />
    </>
  );
}
