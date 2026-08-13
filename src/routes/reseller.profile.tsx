import { createFileRoute } from "@tanstack/react-router";
import { ProfilePage } from "@/components/profile-page";

export const Route = createFileRoute("/reseller/profile")({
  head: () => ({
    meta: [
      { title: "My Profile — WaveWallet Reseller" },
      {
        name: "description",
        content:
          "Update your display name, @handle, profile photo and optional social accounts as a WaveWallet reseller.",
      },
      { property: "og:title", content: "My Profile — WaveWallet Reseller" },
      {
        property: "og:description",
        content: "Manage your reseller display name, @handle, photo and optional social links.",
      },
      { property: "og:type", content: "profile" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ProfilePage,
});
