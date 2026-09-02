import { createFileRoute } from "@tanstack/react-router";
import { ProfilePage } from "@/components/profile-page";
import { AddressCard } from "@/components/universe/address-card";
import { RelationshipsCard } from "@/components/universe/relationships-card";
import { ConnectedLoginsCard } from "@/components/universe/connected-logins-card";
import { UniverseVouchersCard } from "@/components/universe/universe-vouchers-card";
import { UniverseShell } from "@/components/universe/universe-shell";
import { PublicIdentityCard } from "@/components/universe/public-identity-card";
import { useSession } from "@/lib/session";

export const Route = createFileRoute("/universe/profile")({
  head: () => ({
    meta: [
      { title: "My Universe Profile — WaveWallet" },
      {
        name: "description",
        content:
          "Your global WaveWallet identity: display name, unique @handle, profile photo, links and connected sign-in methods.",
      },
      { property: "og:title", content: "My Universe Profile — WaveWallet" },
      {
        property: "og:description",
        content: "Manage your global name, @handle, photo and connected logins.",
      },
      { property: "og:type", content: "profile" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: UniverseProfile,
});

function UniverseProfile() {
  const { account } = useSession();
  return (
    <UniverseShell title="Profile" subtitle="Your global identity">
      <div className="space-y-6 px-4 sm:px-0">
        {account ? <PublicIdentityCard userId={account.id} /> : null}
        <ProfilePage />
        <UniverseVouchersCard />
        <AddressCard />
        <RelationshipsCard />
        <ConnectedLoginsCard />
      </div>
    </UniverseShell>
  );
}
