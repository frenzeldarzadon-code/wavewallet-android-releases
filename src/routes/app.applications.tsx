import { createFileRoute } from "@tanstack/react-router";
import { MemberInboxPanel } from "@/components/member-inbox-panel";

export const Route = createFileRoute("/app/applications")({
  head: () => ({
    meta: [
      { title: "Applications & Invites — WaveWallet" },
      {
        name: "description",
        content:
          "Track the shop memberships you applied for and answer invitations to join a WaveWallet shop.",
      },
      { property: "og:title", content: "Applications & Invites — WaveWallet" },
      {
        property: "og:description",
        content: "Your shop applications and pending shop invitations in one place.",
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
