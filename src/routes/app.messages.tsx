import { createFileRoute } from "@tanstack/react-router";
import { MessagesPage } from "@/components/social/messages-page";

export const Route = createFileRoute("/app/messages")({
  head: () => ({
    meta: [
      { title: "Messages — WaveWallet" },
      {
        name: "description",
        content: "Private one-to-one messages with other members of your WaveWallet shop.",
      },
      { property: "og:title", content: "Messages — WaveWallet" },
      { property: "og:description", content: "Private direct messages inside your shop." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MessagesPage,
});
