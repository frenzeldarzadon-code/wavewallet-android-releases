import { createFileRoute, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/ui-kit";
import { RewardsPage } from "@/components/customer/rewards-page";
import { UniverseShell } from "@/components/universe/universe-shell";
import { fetchPointsEnabled } from "@/lib/rewards";
import { useSession } from "@/lib/session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Rewards Shop of one Universe shop, reached from a seller storefront.
 *
 * Points and rewards stay scoped to the SELLING shop: the page reuses the
 * existing RewardsPage (same points account, `list_rewards` and redemption
 * RPCs); the database refuses anything that is not a Universe shop and never
 * touches the global coin wallet. No membership is required.
 */
export const Route = createFileRoute("/universe/rewards/$shopId")({
  validateSearch: (search: Record<string, unknown>): { name?: string } => {
    const raw = search["name"];
    return typeof raw === "string" && raw.trim() ? { name: raw.trim().slice(0, 80) } : {};
  },
  head: () => ({
    meta: [
      { title: "Shop Rewards — ONE WAVE Universe" },
      {
        name: "description",
        content: "Redeem the points you earned in this Universe shop for its rewards.",
      },
      { property: "og:title", content: "Shop Rewards — ONE WAVE Universe" },
      {
        property: "og:description",
        content: "Shop-specific rewards for points earned buying that shop's vouchers.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: UniverseShopRewards,
});

function UniverseShopRewards() {
  const { shopId } = useParams({ from: "/universe/rewards/$shopId" });
  const { name } = Route.useSearch();
  const { account } = useSession();
  const shopName = name ?? "Shop";
  const shop = useMemo(() => ({ id: shopId, name: shopName }), [shopId, shopName]);
  const valid = UUID.test(shopId);
  // The database already refuses to list or redeem rewards while this shop has
  // reward points switched off; this only shows the reason instead of a blank
  // page when someone opens the link directly.
  const [pointsOn, setPointsOn] = useState<boolean | null>(null);
  useEffect(() => {
    if (!valid) return;
    void fetchPointsEnabled(shopId).then(setPointsOn);
  }, [shopId, valid]);

  return (
    <UniverseShell title={`${shopName} Rewards`} subtitle="Points earned in this shop only">
      <div className="space-y-4 px-4 sm:px-0">
        {!valid ? (
          <EmptyState title="Unknown shop" description="This rewards link is not valid." />
        ) : !account ? (
          <EmptyState
            title="Sign in to see your points"
            description="Points are earned per shop when you buy its vouchers with coins."
          />
        ) : pointsOn === false ? (
          <EmptyState
            title="Rewards are turned off in this shop"
            description="This shop has switched reward points off, so its Rewards Shop is closed and new purchases here earn no points. Points you already earned stay in your balance."
          />
        ) : (
          <RewardsPage shop={shop} />
        )}
      </div>
    </UniverseShell>
  );
}
