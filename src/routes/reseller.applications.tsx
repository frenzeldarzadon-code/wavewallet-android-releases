import { createFileRoute } from "@tanstack/react-router";
import { ApplicationsPanel } from "@/components/applications-panel";
import { MemberInboxPanel } from "@/components/member-inbox-panel";
import { useSession } from "@/lib/session";

export const Route = createFileRoute("/reseller/applications")({
  head: () => ({
    meta: [
      { title: "Applications & Invites — WaveWallet Reseller" },
      {
        name: "description",
        content:
          "Review pending signup applications for your shop and approve or reject membership requests.",
      },
      { property: "og:title", content: "Applications & Invites — WaveWallet Reseller" },
      {
        property: "og:description",
        content: "Approve or reject pending membership applications for your shop.",
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
      description="New members who chose this shop. They cannot enter until approved."
      />
    </>
  );
}
