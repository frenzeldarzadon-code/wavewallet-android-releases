import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { FriendsHub, type FriendsTab } from "@/components/universe/friends-hub";
import { UniverseShell } from "@/components/universe/universe-shell";

const TABS: FriendsTab[] = ["friends", "find", "following"];

export const Route = createFileRoute("/universe/friends")({
  // The tab lives in the URL so the phone back button steps between tabs
  // instead of leaving the page.
  validateSearch: (search: Record<string, unknown>): { tab?: FriendsTab } =>
    TABS.includes(search["tab"] as FriendsTab) ? { tab: search["tab"] as FriendsTab } : {},
  head: () => ({
    meta: [
      { title: "Friends — ONE WAVE Universe" },
      {
        name: "description",
        content:
          "Your friends, people you follow, and a Universe-wide search to find and add anyone in ONE WAVE.",
      },
      { property: "og:title", content: "Friends — ONE WAVE Universe" },
      {
        property: "og:description",
        content: "Friends, Find Friends and Following in the ONE WAVE Universe.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: UniverseFriends,
});

function UniverseFriends() {
  const { tab } = Route.useSearch();
  const navigate = useNavigate({ from: "/universe/friends" });
  return (
    <UniverseShell title="Friends" subtitle="Friends, Find Friends and Following">
      <div className="px-4 sm:px-0">
        <FriendsHub
          tab={tab ?? "friends"}
          onTabChange={(t) => void navigate({ search: { tab: t } })}
        />
      </div>
    </UniverseShell>
  );
}
