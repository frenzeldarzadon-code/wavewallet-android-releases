import { createFileRoute } from "@tanstack/react-router";
import { SOCIAL_ENABLED } from "@/lib/features";
import { SocialDisabled } from "@/components/social/social-disabled";
import { SocialPage } from "@/components/social/social-page";

export const Route = createFileRoute("/app/social")({
  head: () => ({
    meta: [
      { title: "Community Feed — WaveWallet" },
      {
        name: "description",
        content:
          "Share updates, promote products and reply to other members of your WaveWallet shop community.",
      },
      { property: "og:title", content: "Community Feed — WaveWallet" },
      {
        property: "og:description",
        content: "Posts, replies, likes and promoted listings inside your shop community.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SocialPageGate,
});

function SocialPageGate() {
  if (!SOCIAL_ENABLED) return <SocialDisabled backTo="/app" />;
  return <SocialPage />;
}
