import { createFileRoute } from "@tanstack/react-router";
import { SocialPage } from "@/components/social/social-page";

export const Route = createFileRoute("/reseller/social")({
  head: () => ({
    meta: [
      { title: "Community Feed — WaveWallet Reseller" },
      {
        name: "description",
        content:
          "Promote your vouchers and services to your shop community, reply to members and manage social credits.",
      },
      { property: "og:title", content: "Community Feed — WaveWallet Reseller" },
      {
        property: "og:description",
        content: "Promoted listings, posts and replies inside your shop community.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SocialPage,
});
