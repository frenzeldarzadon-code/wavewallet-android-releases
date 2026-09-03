import { createFileRoute } from "@tanstack/react-router";
import { SocialPage } from "@/components/social/social-page";
import { UniverseShell } from "@/components/universe/universe-shell";
import { ShopInvitationsCard } from "@/components/universe/shop-invitations-card";
import { UniverseHomeHero } from "@/components/universe/universe-home-hero";
import { MarketPulse } from "@/components/universe/market-pulse";

export const Route = createFileRoute("/universe/")({
  head: () => ({
    meta: [
      { title: "Universe Feed — WaveWallet Community" },
      {
        name: "description",
        content:
          "The WaveWallet Universe feed: share updates and photos, reply, like and promote listings across the shops you belong to.",
      },
      { property: "og:title", content: "Universe Feed — WaveWallet Community" },
      {
        property: "og:description",
        content: "Posts, photos, replies and likes across the WaveWallet community.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: UniverseFeed,
});

function UniverseFeed() {
  return (
    <UniverseShell title="Home" subtitle="Universe community feed">
      <div className="space-y-4">
        <UniverseHomeHero />
        <MarketPulse />
        <div className="px-4 sm:px-0">
          <ShopInvitationsCard />
        </div>
        <SocialPage />
      </div>
    </UniverseShell>
  );
}
