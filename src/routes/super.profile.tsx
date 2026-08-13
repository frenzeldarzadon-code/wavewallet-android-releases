import { createFileRoute } from "@tanstack/react-router";
import { ProfilePage } from "@/components/profile-page";

export const Route = createFileRoute("/super/profile")({
  head: () => ({
    meta: [
      { title: "My Profile — WaveWallet Super Admin" },
      {
        name: "description",
        content:
          "Update the platform owner display name, contact details and profile photo for the WaveWallet console.",
      },
      { property: "og:title", content: "My Profile — WaveWallet Super Admin" },
      {
        property: "og:description",
        content: "Manage the platform owner display name, contact details and photo.",
      },
      { property: "og:type", content: "profile" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ProfilePage,
});
