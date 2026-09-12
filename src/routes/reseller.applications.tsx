import { createFileRoute } from "@tanstack/react-router";
import { ApplicationsPanel } from "@/components/applications-panel";
import { MemberInboxPanel } from "@/components/member-inbox-panel";
import { NoMembershipApprovalNotice } from "@/components/no-membership-approval-notice";
import { LeaveShopCard } from "@/components/leave-shop-card";
import { useSession } from "@/lib/session";
import { useShopStatus } from "@/lib/shop-status";
import { usesMembershipApproval } from "@/lib/shop-type";

export const Route = createFileRoute("/reseller/applications")({
  head: () => ({
    meta: [
      { title: "New Members — ONE WAVE Reseller" },
      {
        name: "description",
        content:
          "Review members who just joined your shop and keep or remove them.",
      },
      { property: "og:title", content: "New Members — ONE WAVE Reseller" },
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
  const { ecosystem, ecosystemDbId } = useSession("reseller");
  const { shopType } = useShopStatus(ecosystemDbId);
  return (
    <>
      <MemberInboxPanel />
      {usesMembershipApproval(shopType) ? (
        <ApplicationsPanel
          ecosystemId={ecosystemDbId}
          description="Members who joined this shop automatically. They are already active — keep or remove them."
        />
      ) : (
        <NoMembershipApprovalNotice />
      )}
      <LeaveShopCard ecosystemId={ecosystemDbId} ecosystemName={ecosystem?.name ?? "this shop"} />
    </>
  );
}
