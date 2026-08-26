/**
 * Status Checker for resellers and subresellers.
 *
 * Lookup only: controller management stays in the Admin console. The status
 * itself comes from the shop's own hotspot controller on the server.
 */
import { createFileRoute } from "@tanstack/react-router";
import { PageSection } from "@/components/ui-kit";
import { OmadaVoucherStatusPanel } from "@/components/omada/omada-voucher-status-panel";
import { useSession } from "@/lib/session";

export const Route = createFileRoute("/reseller/omada")({
  head: () => ({
    meta: [
      { title: "Voucher status checker — WaveWallet Reseller" },
      {
        name: "description",
        content:
          "Check a Wi-Fi voucher code, see whether it is unused, in-use or expired, and label the devices using it.",
      },
      { property: "og:title", content: "Voucher status checker — WaveWallet Reseller" },
      {
        property: "og:description",
        content: "Check a Wi-Fi voucher code and label the devices using it.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResellerStatusChecker,
});

function ResellerStatusChecker() {
  const { ecosystemDbId } = useSession("reseller");
  return (
    <PageSection
      title="Voucher status checker"
      description="Search a voucher code to see whether it is unused, in-use or expired."
    >
      <OmadaVoucherStatusPanel ecosystemId={ecosystemDbId} />
    </PageSection>
  );
}
