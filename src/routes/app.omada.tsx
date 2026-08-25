/**
 * Member-facing Wi-Fi voucher status for the member's active shop.
 *
 * Read-only: the lookup runs on the server against that shop's own controller
 * and only members of that shop may call it.
 */
import { createFileRoute } from "@tanstack/react-router";
import { PageSection } from "@/components/ui-kit";
import { OmadaVoucherStatusPanel } from "@/components/omada/omada-voucher-status-panel";
import { useSession } from "@/lib/session";

export const Route = createFileRoute("/app/omada")({
  head: () => ({
    meta: [
      { title: "Wi-Fi voucher status — WaveWallet" },
      {
        name: "description",
        content: "Check the status of a Wi-Fi voucher issued by your shop's hotspot controller.",
      },
      { property: "og:title", content: "Wi-Fi voucher status — WaveWallet" },
      {
        property: "og:description",
        content: "Check the status of a Wi-Fi voucher issued by your shop's hotspot controller.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MemberOmada,
});

function MemberOmada() {
  const { ecosystemDbId } = useSession("customer");
  return (
    <PageSection
      title="Wi-Fi voucher status"
      description="Check a voucher code against your shop's hotspot controller."
    >
      <OmadaVoucherStatusPanel ecosystemId={ecosystemDbId} />
    </PageSection>
  );
}
