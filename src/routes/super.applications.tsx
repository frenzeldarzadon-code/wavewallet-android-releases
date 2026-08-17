import { createFileRoute } from "@tanstack/react-router";
import { ApplicationsPanel } from "@/components/applications-panel";
import { useSession } from "@/lib/session";

export const Route = createFileRoute("/super/applications")({
  head: () => ({
    meta: [
      { title: "New Members — WaveWallet Platform" },
      {
        name: "description",
        content:
          "Review members who joined any WaveWallet shop and keep or remove them per shop.",
      },
      { property: "og:title", content: "New Members — WaveWallet Platform" },
      {
        property: "og:description",
        content: "Keep or remove newly joined members across all shops.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SuperApplications,
});

function SuperApplications() {
  const session = useSession("super_admin");
  if (!session.account) return null;
  return (
    <ApplicationsPanel
      ecosystemId={null}
      showEcosystem
      title="New members"
      description="Every new member across the platform, with the shop they joined."
    />
  );
}
