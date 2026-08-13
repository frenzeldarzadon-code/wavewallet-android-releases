import { createFileRoute } from "@tanstack/react-router";
import { ProfilePage } from "@/components/profile-page";

export const Route = createFileRoute("/app/profile")({
  head: () => ({
    meta: [
      { title: "My Profile — WaveWallet" },
      {
        name: "description",
        content:
          "Update your display name, choose a unique @handle and set a profile photo for your WaveWallet account.",
      },
      { property: "og:title", content: "My Profile — WaveWallet" },
      {
        property: "og:description",
        content: "Manage your display name, @handle and profile photo.",
      },
      { property: "og:type", content: "profile" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ProfilePage,
});

