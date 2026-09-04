/**
 * Universe → Reward Shops: every shop where the member has points (or has
 * bought/joined), each opening that shop's existing Rewards Shop.
 */
import { Link, createFileRoute } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageSection } from "@/components/ui-kit";
import { CustomerShopList, useCustomerShops } from "@/components/universe/customer-shop-list";
import { UniverseShell } from "@/components/universe/universe-shell";
import { rewardShops } from "@/lib/customer-shops";

export const Route = createFileRoute("/universe/rewards/")({
  head: () => ({
    meta: [
      { title: "Reward Shops — ONE WAVE Universe" },
      {
        name: "description",
        content:
          "See the points you earned in each ONE WAVE shop and open its Rewards Shop to redeem them.",
      },
      { property: "og:title", content: "Reward Shops — ONE WAVE Universe" },
      { property: "og:description", content: "Your points, shop by shop, and where to redeem them." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: UniverseRewardShops,
});

function UniverseRewardShops() {
  const { shops, error } = useCustomerShops();
  const eligible = shops ? rewardShops(shops) : null;
  return (
    <UniverseShell title="Reward Shops" subtitle="Points are earned and redeemed per shop">
      <div className="px-4 sm:px-0">
        <PageSection
          title="Your reward shops"
          description="Buying a shop's vouchers with coins earns points in that shop. Open a shop to see its rewards."
        >
          <CustomerShopList
            shops={eligible}
            error={error}
            linkFor={(s) => ({
              to: "/universe/rewards/$shopId",
              params: { shopId: s.id },
              search: { name: s.name },
            })}
            detail={(s) => `${s.points.toLocaleString()} point${s.points === 1 ? "" : "s"}`}
            empty={
              <div className="rounded-xl border border-dashed border-border bg-card/50 px-4 py-10 text-center">
                <p className="text-sm font-medium">No reward shops yet</p>
                <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
                  Buy a voucher from any Universe shop and you start earning that shop's points.
                </p>
                <Button asChild size="sm" className="mt-4 rounded-lg">
                  <Link to="/universe/search">
                    <Search className="size-4" /> Find vouchers & sellers
                  </Link>
                </Button>
              </div>
            }
          />
        </PageSection>
      </div>
    </UniverseShell>
  );
}
