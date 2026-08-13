import { createFileRoute } from "@tanstack/react-router";
import { ProfilePage } from "@/components/profile-page";

export const Route = createFileRoute("/admin/profile")({
  head: () => ({
    meta: [
      { title: "My Profile — WaveWallet Admin" },
      {
        name: "description",
        content:
          "Update your admin display name, @handle, contact details and profile photo for your WaveWallet shop.",
      },
      { property: "og:title", content: "My Profile — WaveWallet Admin" },
      {
        property: "og:description",
        content: "Manage your admin display name, @handle, contact details and photo.",
      },
      { property: "og:type", content: "profile" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ProfilePage,
});
