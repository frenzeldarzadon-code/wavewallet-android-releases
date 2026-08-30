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
import { PortalMappingPanel } from "@/components/omada/portal-mapping-panel";
import { PortalTemplateWizard } from "@/components/omada/portal-template-wizard";
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
  ): { code?: string | undefined; tab?: "connection" | "devices" | "generate" | "status" | "portal" | undefined } => ({
    code: typeof search["code"] === "string" && search["code"] ? search["code"] : undefined,
    tab:
      search["tab"] === "connection" ||
      search["tab"] === "devices" ||
      search["tab"] === "generate" ||
      search["tab"] === "status" ||
      search["tab"] === "portal"
        ? search["tab"]
        : undefined,
  }),
  component: AdminOmada,
});

function AdminOmada() {
  const { ecosystemDbId, ecosystem } = useSession("admin");
  const { code, tab } = Route.useSearch();

  return (
    <PageSection
      title="Omada"
      description="Your shop's own Omada controller. These details and any vouchers generated here belong to this shop only."
    >
      <Tabs defaultValue={tab ?? (code ? "status" : "connection")} className="w-full">
        {/* Wraps into rows on narrow phones instead of squeezing five columns. */}
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1.5 p-1.5">
          <TabsTrigger value="connection" className="h-9 flex-auto px-3 text-xs sm:text-sm">
            Connection
          </TabsTrigger>
          <TabsTrigger value="devices" className="h-9 flex-auto px-3 text-xs sm:text-sm">
            Devices
          </TabsTrigger>
          <TabsTrigger value="generate" className="h-9 flex-auto px-3 text-xs sm:text-sm">
            Generate
          </TabsTrigger>
          <TabsTrigger value="status" className="h-9 flex-auto px-3 text-xs sm:text-sm">
            Status
          </TabsTrigger>
          <TabsTrigger value="portal" className="h-9 flex-auto px-3 text-xs sm:text-sm">
            Portal
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
          <OmadaVoucherStatusPanel ecosystemId={ecosystemDbId} initialCode={code} />
          <TracerConflictsPanel ecosystemId={ecosystemDbId} />
        </TabsContent>

        <TabsContent value="portal" className="mt-4 space-y-4">
          <PortalMappingPanel ecosystemId={ecosystemDbId} shopName={ecosystem?.name ?? null} />
          <PortalTemplateWizard ecosystemId={ecosystemDbId} />
        </TabsContent>
      </Tabs>
    </PageSection>
  );
}
