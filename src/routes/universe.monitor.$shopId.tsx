/**
 * Universe → Live Monitoring for ONE shop.
 *
 * Renders the exact same LiveVoucherMonitoring board the shop console uses,
 * against the chosen shop. The server functions re-check entitlement on every
 * call, so this page can never show another member's data or a shop the
 * caller is not entitled to.
 */
import { Link, createFileRoute, useParams } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { LiveVoucherMonitoring } from "@/components/omada/live-voucher-monitoring";
import { EmptyState, PageSection } from "@/components/ui-kit";
import { UniverseShell } from "@/components/universe/universe-shell";
import { canMonitor, type CustomerShop } from "@/lib/customer-shops";
import { listCustomerShops } from "@/lib/voucher-monitoring.functions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const Route = createFileRoute("/universe/monitor/$shopId")({
  validateSearch: (search: Record<string, unknown>): { code?: string | undefined } => ({
    code: typeof search["code"] === "string" && search["code"] ? search["code"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Live Voucher Monitoring — ONE WAVE Universe" },
      {
        name: "description",
        content:
          "Watch your Wi-Fi vouchers live: status, running time, remaining time and data straight from the shop's hotspot controller.",
      },
      { property: "og:title", content: "Live Voucher Monitoring — ONE WAVE Universe" },
      {
        property: "og:description",
        content: "Live status of the vouchers you bought, read from the shop's controller.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: UniverseMonitorShop,
});

function UniverseMonitorShop() {
  const { shopId } = useParams({ from: "/universe/monitor/$shopId" });
  const { code } = Route.useSearch();
  const load = useServerFn(listCustomerShops);
  const [shop, setShop] = useState<CustomerShop | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    if (!UUID.test(shopId)) {
      setShop(null);
      return;
    }
    load()
      .then((rows) => alive && setShop(rows.find((s) => s.id === shopId && canMonitor(s)) ?? null))
      .catch(() => alive && setShop(null));
    return () => {
      alive = false;
    };
  }, [load, shopId]);

  return (
    <UniverseShell
      title={shop ? `${shop.name} · Live Monitoring` : "Live Monitoring"}
      subtitle="Read live from the shop's hotspot controller"
    >
      <div className="space-y-3 px-4 sm:px-0">
        <Link
          to="/universe/monitor"
          className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-2 hover:underline"
        >
          <ArrowLeft className="size-3.5" /> All shops
        </Link>
        {shop === undefined ? null : shop === null ? (
          <EmptyState
            title="No monitoring access for this shop"
            description="Live Monitoring is available for shops you bought a voucher from or belong to."
          />
        ) : (
          <PageSection
            title="Live Voucher Monitoring"
            description="Live status for the vouchers you are watching in this shop."
          >
            <LiveVoucherMonitoring ecosystemId={shop.id} highlightCode={code} />
          </PageSection>
        )}
      </div>
    </UniverseShell>
  );
}
