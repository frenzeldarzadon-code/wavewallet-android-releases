import { createFileRoute } from "@tanstack/react-router";
import { NotificationsPage } from "@/components/universe/notifications-page";
import { UniverseShell } from "@/components/universe/universe-shell";

export const Route = createFileRoute("/universe/notifications")({
  head: () => ({
    meta: [
      { title: "Notifications — ONE WAVE Universe" },
      {
        name: "description",
        content:
          "Your ONE WAVE alerts: likes, replies, mentions, private messages, friend requests, follows, social coin gifts, cashback and shop updates.",
      },
      { property: "og:title", content: "Notifications — ONE WAVE Universe" },
      {
        property: "og:description",
        content: "Every alert about your ONE WAVE account, in one private list.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: UniverseNotifications,
});

function UniverseNotifications() {
  return (
    <UniverseShell title="Notifications" subtitle="Only you can see these">
      <div className="px-4 sm:px-0">
        <NotificationsPage />
      </div>
    </UniverseShell>
  );
}
