import { createFileRoute } from "@tanstack/react-router";
import { MemberInboxPanel } from "@/components/member-inbox-panel";

export const Route = createFileRoute("/app/applications")({
  head: () => ({
    meta: [
      { title: "Shops & Invites — WaveWallet" },
      {
        name: "description",
        content:
          "See the WaveWallet shops you joined and answer invitations to join another shop.",
      },
      { property: "og:title", content: "Shops & Invites — WaveWallet" },
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
  return <MemberInboxPanel />;
}
