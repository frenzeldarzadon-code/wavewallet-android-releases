import { createFileRoute } from "@tanstack/react-router";
import { MessagesPage } from "@/components/social/messages-page";
import { UniverseShell } from "@/components/universe/universe-shell";

export const Route = createFileRoute("/universe/messages")({
  validateSearch: (search: Record<string, unknown>): { thread?: string } =>
    typeof search["thread"] === "string" && search["thread"] ? { thread: search["thread"] } : {},
  head: () => ({
    meta: [
      { title: "Messages — WaveWallet Universe" },
      {
        name: "description",
        content:
          "Private messages and Retail order chats in the WaveWallet Universe. Only the participants can read a thread.",
      },
      { property: "og:title", content: "Messages — WaveWallet Universe" },
      { property: "og:description", content: "Private direct messages and order chats between members." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: UniverseMessages,
});

function UniverseMessages() {
  const { thread } = Route.useSearch();
  return (
    <UniverseShell title="Messages" subtitle="Private conversations and order chats">
      <MessagesPage initialThreadId={thread ?? null} />
    </UniverseShell>
  );
}
