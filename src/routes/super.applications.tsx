import { createFileRoute } from "@tanstack/react-router";
import { ApplicationsPanel } from "@/components/applications-panel";
import { useSession } from "@/lib/session";

export const Route = createFileRoute("/super/applications")({
  head: () => ({
    meta: [
      { title: "Signup Applications — WaveWallet Platform" },
      {
        name: "description",
        content:
          "Review self-service signup applications across every WaveWallet shop and approve or reject membership.",
      },
      { property: "og:title", content: "Signup Applications — WaveWallet Platform" },
      {
        property: "og:description",
        content: "Approve or reject pending membership applications across all shops.",
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
      title="Signup applications"
      description="Every self-service signup across the platform, with the shop each applicant chose."
    />
  );
}
