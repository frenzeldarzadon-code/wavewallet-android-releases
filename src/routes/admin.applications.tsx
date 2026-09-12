import { createFileRoute } from "@tanstack/react-router";
import { ApplicationsPanel } from "@/components/applications-panel";
import { MemberInboxPanel } from "@/components/member-inbox-panel";
import { NoMembershipApprovalNotice } from "@/components/no-membership-approval-notice";
import { useSession } from "@/lib/session";
import { useShopStatus } from "@/lib/shop-status";
import { usesMembershipApproval } from "@/lib/shop-type";

export const Route = createFileRoute("/admin/applications")({
  head: () => ({
    meta: [
      { title: "New Members — ONE WAVE Admin" },
      {
        name: "description",
        content:
          "Review members who just joined your shop and keep or remove them.",
      },
      { property: "og:title", content: "New Members — ONE WAVE Admin" },
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
  const { shopType } = useShopStatus(ecosystemDbId);
  return (
    <>
      <MemberInboxPanel />
      {usesMembershipApproval(shopType) ? (
        <ApplicationsPanel
          ecosystemId={ecosystemDbId}
          description="Members who joined your shop automatically. They are already active — keep or remove them."
        />
      ) : (
        <NoMembershipApprovalNotice />
      )}
    </>
  );
}
