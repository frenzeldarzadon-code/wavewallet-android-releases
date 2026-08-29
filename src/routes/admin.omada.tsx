/**
 * Dedicated Omada section for ONE shop's own controller.
 *
 * Tabs: Connection (credentials + health), Generate voucher (admin), Voucher
 * status (read-only lookup). Everything here is scoped to the admin's active
 * shop — the server re-authorises every call against that ecosystem.
 */
import { createFileRoute } from "@tanstack/react-router";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageSection } from "@/components/ui-kit";
import { OmadaConnectionCard } from "@/components/shop/omada-connection-card";
import { OmadaHealthCard } from "@/components/shop/omada-health-card";
import { OmadaGeneratePanel } from "@/components/omada/omada-generate-panel";
import { OmadaVoucherStatusPanel } from "@/components/omada/omada-voucher-status-panel";
import { TracerConflictsPanel } from "@/components/omada/tracer-conflicts-panel";
import { AntennaStatusPanel } from "@/components/omada/antenna-status-panel";
import { useSession } from "@/lib/session";

export const Route = createFileRoute("/admin/omada")({
  head: () => ({
    meta: [
      { title: "Omada Integration — WaveWallet Admin" },
      {
        name: "description",
        content:
          "Connect your shop's own Omada controller, generate hotspot vouchers and check voucher status.",
      },
      { property: "og:title", content: "Omada Integration — WaveWallet Admin" },
      {
        property: "og:description",
        content:
          "Connect your shop's own Omada controller, generate hotspot vouchers and check voucher status.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  validateSearch: (
    search: Record<string, unknown>,
  ): { code?: string; tab?: "connection" | "devices" | "generate" | "status" } => ({
    code: typeof search["code"] === "string" && search["code"] ? search["code"] : undefined,
    tab:
      search["tab"] === "connection" ||
      search["tab"] === "devices" ||
      search["tab"] === "generate" ||
      search["tab"] === "status"
        ? search["tab"]
        : undefined,
  }),
  component: AdminOmada,
});

function AdminOmada() {
  const { ecosystemDbId } = useSession("admin");
  const { code, tab } = Route.useSearch();

  return (
    <PageSection
      title="Omada"
      description="Your shop's own Omada controller. These details and any vouchers generated here belong to this shop only."
    >
      <Tabs defaultValue={tab ?? (code ? "status" : "connection")} className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="connection" className="text-xs sm:text-sm">
            Connection
          </TabsTrigger>
          <TabsTrigger value="devices" className="text-xs sm:text-sm">
            Device Status
          </TabsTrigger>
          <TabsTrigger value="generate" className="text-xs sm:text-sm">
            Generate
          </TabsTrigger>
          <TabsTrigger value="status" className="text-xs sm:text-sm">
            Status
          </TabsTrigger>
        </TabsList>

        <TabsContent value="connection" className="mt-4 space-y-4">
          <OmadaConnectionCard ecosystemId={ecosystemDbId} />
          <OmadaHealthCard ecosystemId={ecosystemDbId} />
        </TabsContent>

        <TabsContent value="devices" className="mt-4">
          <AntennaStatusPanel ecosystemId={ecosystemDbId} manage />
        </TabsContent>

        <TabsContent value="generate" className="mt-4">
          <OmadaGeneratePanel ecosystemId={ecosystemDbId} />
        </TabsContent>

        <TabsContent value="status" className="mt-4 space-y-4">
          <OmadaVoucherStatusPanel ecosystemId={ecosystemDbId} />
          <TracerConflictsPanel ecosystemId={ecosystemDbId} />
        </TabsContent>
      </Tabs>
    </PageSection>
  );
}
