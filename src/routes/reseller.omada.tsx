/**
 * Status Checker for resellers and subresellers.
 *
 * Lookup only: controller management stays in the Admin console. The status
 * itself comes from the shop's own hotspot controller on the server.
 */
import { createFileRoute } from "@tanstack/react-router";
import { PageSection } from "@/components/ui-kit";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OmadaVoucherStatusPanel } from "@/components/omada/omada-voucher-status-panel";
import { AntennaStatusPanel } from "@/components/omada/antenna-status-panel";
import { useSession } from "@/lib/session";

export const Route = createFileRoute("/reseller/omada")({
  head: () => ({
    meta: [
      { title: "Status Check — WaveWallet Reseller" },
      {
        name: "description",
        content:
          "Check a Wi-Fi voucher code, see whether it is unused, in-use or expired, and label the devices using it.",
      },
      { property: "og:title", content: "Status Check — WaveWallet Reseller" },
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
      title="Status Check"
      description="Your assigned antennas and voucher lookup for this shop."
    >
      <Tabs defaultValue="antenna" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="antenna" className="text-xs sm:text-sm">
            Antenna Status
          </TabsTrigger>
          <TabsTrigger value="voucher" className="text-xs sm:text-sm">
            Voucher Status
          </TabsTrigger>
        </TabsList>

        <TabsContent value="antenna" className="mt-4">
          <AntennaStatusPanel ecosystemId={ecosystemDbId} />
        </TabsContent>

        <TabsContent value="voucher" className="mt-4">
          <OmadaVoucherStatusPanel ecosystemId={ecosystemDbId} />
        </TabsContent>
      </Tabs>
    </PageSection>
  );
}
