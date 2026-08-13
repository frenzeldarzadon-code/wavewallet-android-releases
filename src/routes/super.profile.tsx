import { createFileRoute } from "@tanstack/react-router";
import { SuperProfilePage } from "@/components/super/super-profile-page";

export const Route = createFileRoute("/super/profile")({
  head: () => ({
    meta: [
      { title: "Platform Owner Profile — WaveWallet" },
      {
        name: "description",
        content:
          "Update the platform owner display name, contact details and profile photo for the WaveWallet console.",
      },
      { property: "og:title", content: "Platform Owner Profile — WaveWallet" },
      {
        property: "og:description",
        content: "Manage the platform owner display name, contact details and photo.",
      },
      { property: "og:type", content: "profile" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SuperProfilePage,
});
