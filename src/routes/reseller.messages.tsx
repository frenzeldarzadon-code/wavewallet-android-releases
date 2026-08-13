import { createFileRoute } from "@tanstack/react-router";
import { SOCIAL_ENABLED } from "@/lib/features";
import { SocialDisabled } from "@/components/social/social-disabled";
import { MessagesPage } from "@/components/social/messages-page";

export const Route = createFileRoute("/reseller/messages")({
  head: () => ({
    meta: [
      { title: "Messages — WaveWallet Reseller" },
      {
        name: "description",
        content: "Private one-to-one messages with customers and members of your shop.",
      },
      { property: "og:title", content: "Messages — WaveWallet Reseller" },
      { property: "og:description", content: "Private direct messages inside your shop." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MessagesPageGate,
});

function MessagesPageGate() {
  if (!SOCIAL_ENABLED) return <SocialDisabled backTo="/reseller" />;
  return <MessagesPage />;
}
