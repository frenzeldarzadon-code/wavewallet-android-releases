import { createFileRoute } from "@tanstack/react-router";
import { MemberInboxPanel } from "@/components/member-inbox-panel";
import { LeaveShopCard } from "@/components/leave-shop-card";
import { useSession } from "@/lib/session";

export const Route = createFileRoute("/app/applications")({
  head: () => ({
    meta: [
      { title: "Shops & Invites — ONE WAVE" },
      {
        name: "description",
        content:
          "See the ONE WAVE shops you joined and answer invitations to join another shop.",
      },
      { property: "og:title", content: "Shops & Invites — ONE WAVE" },
      {
        property: "og:description",
        content: "Your shop memberships and pending shop invitations in one place.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CustomerInbox,
});

function CustomerInbox() {
  const { ecosystem, ecosystemDbId } = useSession("customer");
  return (
    <div className="space-y-4">
      <MemberInboxPanel />
      <LeaveShopCard ecosystemId={ecosystemDbId} ecosystemName={ecosystem?.name ?? "this shop"} />
    </div>
  );
}
