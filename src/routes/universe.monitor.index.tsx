/**
 * Universe → Live Monitoring: choose which shop to watch.
 *
 * Eligibility comes from the existing rule (active member OR bought a voucher
 * that shop issued); the list is derived server-side from the caller's own
 * rows. Picking a shop opens that shop's existing monitoring board.
 */
import { Link, createFileRoute } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageSection } from "@/components/ui-kit";
import { CustomerShopList, useCustomerShops } from "@/components/universe/customer-shop-list";
import { UniverseShell } from "@/components/universe/universe-shell";
import { monitorableShops } from "@/lib/customer-shops";

export const Route = createFileRoute("/universe/monitor/")({
  head: () => ({
    meta: [
      { title: "Live Monitoring — ONE WAVE Universe" },
      {
        name: "description",
        content:
          "Pick a shop and watch your Wi-Fi vouchers live: status, running time, remaining time and data from that shop's hotspot controller.",
      },
      { property: "og:title", content: "Live Monitoring — ONE WAVE Universe" },
      {
        property: "og:description",
        content: "Choose a shop and watch your purchased vouchers live.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: UniverseMonitorIndex,
});

function UniverseMonitorIndex() {
  const { shops, error } = useCustomerShops();
  const eligible = shops ? monitorableShops(shops) : null;
  return (
    <UniverseShell title="Live Monitoring" subtitle="Choose a shop to watch your vouchers">
      <div className="px-4 sm:px-0">
        <PageSection
          title="Your shops"
          description="You can monitor a shop once you have bought one of its vouchers or are a member of it."
        >
          <CustomerShopList
            shops={eligible}
            error={error}
            linkFor={(s) => ({ to: "/universe/monitor/$shopId", params: { shopId: s.id } })}
            detail={(s) =>
              s.ownedVouchers > 0
                ? `${s.ownedVouchers} voucher${s.ownedVouchers === 1 ? "" : "s"} bought${s.controllerConfigured ? "" : " · controller not connected"}`
                : s.controllerConfigured
                  ? "Member"
                  : "Member · controller not connected"
            }
            empty={
              <div className="rounded-xl border border-dashed border-border bg-card/50 px-4 py-10 text-center">
                <p className="text-sm font-medium">Nothing to monitor yet</p>
                <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
                  Live Monitoring unlocks the moment you buy a voucher from any Universe shop — no
                  membership needed. Find a shop, pick a seller and pay with your Universe coins.
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
