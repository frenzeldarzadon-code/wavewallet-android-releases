import { createFileRoute } from "@tanstack/react-router";
import { MessagesPage } from "@/components/social/messages-page";
import { UniverseShell } from "@/components/universe/universe-shell";

export const Route = createFileRoute("/universe/messages")({
  head: () => ({
    meta: [
      { title: "Messages — WaveWallet Universe" },
      {
        name: "description",
        content:
          "Private one-to-one messages in the WaveWallet Universe. Only the two participants can read a thread.",
      },
      { property: "og:title", content: "Messages — WaveWallet Universe" },
      { property: "og:description", content: "Private direct messages between members." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: UniverseMessages,
});

function UniverseMessages() {
  return (
    <UniverseShell title="Messages" subtitle="Private conversations">
      <MessagesPage />
    </UniverseShell>
  );
}
