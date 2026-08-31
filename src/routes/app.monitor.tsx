/**
 * Customer Live Voucher Monitoring.
 *
 * Read-only: every value comes from the shop's own hotspot controller, and the
 * only thing this page can change is the customer's private monitoring list.
 */
import { createFileRoute } from "@tanstack/react-router";
import { PageSection } from "@/components/ui-kit";
import { LiveVoucherMonitoring } from "@/components/omada/live-voucher-monitoring";
import { useSession } from "@/lib/session";

export const Route = createFileRoute("/app/monitor")({
  head: () => ({
    meta: [
      { title: "Live Voucher Monitoring — WaveWallet" },
      {
        name: "description",
        content:
          "Watch your Wi-Fi vouchers live: status, running time, remaining time and data straight from your shop's hotspot controller.",
      },
      { property: "og:title", content: "Live Voucher Monitoring — WaveWallet" },
      {
        property: "og:description",
        content:
          "Watch your Wi-Fi vouchers live: status, running time, remaining time and data straight from your shop's hotspot controller.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): { code?: string | undefined } => ({
    code: typeof search["code"] === "string" && search["code"] ? search["code"] : undefined,
  }),
  component: MonitorPage,
});

function MonitorPage() {
  const { ecosystemDbId } = useSession("customer");
  const { code } = Route.useSearch();
  return (
    <PageSection
      title="Live Voucher Monitoring"
      description="Live status for the vouchers you are watching, read from your shop's hotspot controller."
    >
      <LiveVoucherMonitoring ecosystemId={ecosystemDbId} highlightCode={code} />
    </PageSection>
  );
}
