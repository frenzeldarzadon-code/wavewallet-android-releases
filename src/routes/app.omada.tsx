/**
 * Member-facing Wi-Fi voucher status for the member's active shop.
 *
 * Read-only: the lookup runs on the server against that shop's own controller
 * and only members of that shop may call it.
 */
import { createFileRoute } from "@tanstack/react-router";
import { PageSection } from "@/components/ui-kit";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OmadaVoucherStatusPanel } from "@/components/omada/omada-voucher-status-panel";
import { AntennaStatusPanel } from "@/components/omada/antenna-status-panel";
import { useSession } from "@/lib/session";

export const Route = createFileRoute("/app/omada")({
  head: () => ({
    meta: [
      { title: "Status Check — WaveWallet" },
      {
        name: "description",
        content: "Check your assigned antennas and any Wi-Fi voucher issued by your shop's hotspot controller.",
      },
      { property: "og:title", content: "Status Check — WaveWallet" },
      {
        property: "og:description",
        content: "Check your assigned antennas and any Wi-Fi voucher issued by your shop's hotspot controller.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>) => ({
    code: typeof search["code"] === "string" && search["code"] ? search["code"] : undefined,
    tab: search["tab"] === "voucher" || search["tab"] === "antenna" ? search["tab"] : undefined,
  }),
  component: MemberOmada,
});

function MemberOmada() {
  const { ecosystemDbId } = useSession("customer");
  const { code, tab } = Route.useSearch();
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
          <OmadaVoucherStatusPanel ecosystemId={ecosystemDbId} initialCode={code} />
        </TabsContent>
      </Tabs>
    </PageSection>
  );
}
