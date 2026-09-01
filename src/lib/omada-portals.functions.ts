/**
 * Admin setup of the WaveWallet customer captive portal, scoped to ONE shop.
 *
 * Sites and portals are always read live from that shop's OWN controller using
 * the existing encrypted connection and session helpers. Nothing is cached from
 * another tenant and no portal is ever chosen implicitly: the admin must pick
 * the exact portal before a mapping can be saved.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  normalizePortalFlags,
  type MappingCandidate,
  type PortalFeatureFlags,
} from "./portal-mapping";
import type { PortalCapabilities } from "./omada-portals.server";

type AuthContext = {
  supabase: {
    rpc: (fn: string, args: unknown) => Promise<{ data: unknown; error: { message: string } | null }>;
  };
  userId: string;
};

async function assertShopAdmin(context: AuthContext, ecosystemId: string) {
  const owner = await context.supabase.rpc("is_super_admin", { _user_id: context.userId });
  if (owner.error) throw new Error(owner.error.message);
  if (owner.data === true) return;
  const admin = await context.supabase.rpc("is_ecosystem_admin", {
    _user_id: context.userId,
    _ecosystem_id: ecosystemId,
  });
  if (admin.error) throw new Error(admin.error.message);
  if (admin.data !== true) {
    throw new Error("You can only set up the customer portal of your own shop.");
  }
}

export interface PortalSiteOption {
  id: string;
  name: string;
}

export interface PortalOption {
  id: string;
  name: string;
  ssids: string[];
}

export interface PortalSetup {
  configured: boolean;
  connectionStatus: string;
  capabilities: PortalCapabilities | null;
  sites: PortalSiteOption[];
  /** Site currently resolved by the saved connection, if any. */
  activeSiteId: string | null;
  error: string | null;
}

export interface PortalMappingView extends MappingCandidate {
  flags: PortalFeatureFlags;
  lastTestStatus: string | null;
  lastTestAt: string | null;
  lastTestDetail: string | null;
  /** Result of the last EXTERNAL-PORTAL read-back against the controller. */
  externalStatus: string | null;
  externalCheckedAt: string | null;
  externalDetail: string | null;
  externalUrl: string | null;
  updatedAt: string;
}

function mappingView(row: Record<string, unknown>): PortalMappingView {
  return {
    id: String(row["id"]),
    ecosystemId: String(row["ecosystem_id"]),
    siteId: String(row["site_id"]),
    siteName: (row["site_name"] as string | null) ?? null,
    portalId: String(row["portal_id"]),
    portalName: (row["portal_name"] as string | null) ?? null,
    ssidInfo: (row["ssid_info"] as string | null) ?? null,
    enabled: row["enabled"] !== false,
    flags: normalizePortalFlags(row["settings"]),
    lastTestStatus: (row["last_test_status"] as string | null) ?? null,
    lastTestAt: (row["last_test_at"] as string | null) ?? null,
    lastTestDetail: (row["last_test_detail"] as string | null) ?? null,
    externalStatus: (row["auto_config_status"] as string | null) ?? null,
    externalCheckedAt: (row["auto_config_at"] as string | null) ?? null,
    externalDetail: (row["auto_config_detail"] as string | null) ?? null,
    externalUrl: (row["auto_config_url"] as string | null) ?? null,
    updatedAt: String(row["updated_at"] ?? ""),
  };
}

/** Connection state + what this controller can actually do + its real sites. */
export const getPortalSetup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { ecosystemId: string }) => {
    if (!data?.ecosystemId) throw new Error("A shop is required.");
    return data;
  })
  .handler(async ({ data, context }): Promise<PortalSetup> => {
    await assertShopAdmin(context as unknown as AuthContext, data.ecosystemId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const base: PortalSetup = {
      configured: false,
      connectionStatus: "not_connected",
      capabilities: null,
      sites: [],
      activeSiteId: null,
      error: null,
    };
    const { data: row } = await supabaseAdmin
      .from("omada_connections")
      .select("last_status")
      .eq("ecosystem_id", data.ecosystemId)
      .maybeSingle();
    if (!row) return base;

    const { openOmadaSession, omadaEnvelope } = await import("./omada-api.server");
    const { discoverPortalCapabilities, rowsOf } = await import("./omada-portals.server");
    const { loadHotspotCredentials } = await import("./omada-hotspot.server");
    try {
      const session = await openOmadaSession(supabaseAdmin as never, data.ecosystemId);
      const capabilities = await discoverPortalCapabilities(session, {
        hotspotOperatorConfigured: Boolean(await loadHotspotCredentials(supabaseAdmin, ecosystemId)),
      });
      const res = await fetch(
        `${session.base}/openapi/v1/${session.omadacId}/sites?page=1&pageSize=100`,
        { headers: { Authorization: `AccessToken=${session.token}` } },
      );
      let sites: PortalSiteOption[] = [];
      try {
        const env = omadaEnvelope(await res.json());
        sites = rowsOf(env.result)
          .map((s) => ({
            id: String(s["siteId"] ?? s["id"] ?? ""),
            name: String(s["name"] ?? s["siteName"] ?? ""),
          }))
          .filter((s) => s.id);
      } catch {
        /* sites stay empty; capabilities still reported */
      }
      return {
        configured: true,
        connectionStatus: String(row.last_status ?? "untested"),
        capabilities,
        sites,
        activeSiteId: session.siteId,
        error: null,
      };
    } catch (e) {
      return {
        ...base,
        configured: true,
        connectionStatus: String(row.last_status ?? "untested"),
        error: e instanceof Error ? e.message : String(e),
      };
    }
  });

/** The real portals of ONE site. Never filtered, never pre-selected. */
export const listSitePortalOptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { ecosystemId: string; siteId: string }) => {
    if (!data?.ecosystemId) throw new Error("A shop is required.");
    if (!data?.siteId) throw new Error("Choose a site first.");
    return data;
  })
  .handler(async ({ data, context }): Promise<{ portals: PortalOption[]; error: string | null }> => {
    await assertShopAdmin(context as unknown as AuthContext, data.ecosystemId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { openOmadaSession } = await import("./omada-api.server");
    const { discoverPortalCapabilities, listSitePortals } = await import("./omada-portals.server");
    const { loadHotspotCredentials } = await import("./omada-hotspot.server");
    try {
      const session = await openOmadaSession(supabaseAdmin as never, data.ecosystemId);
      const caps = await discoverPortalCapabilities(session, {
        hotspotOperatorConfigured: Boolean(await loadHotspotCredentials(supabaseAdmin, ecosystemId)),
      });
      const portals = await listSitePortals({ ...session, siteId: data.siteId }, caps);
      return { portals: portals.map((p) => ({ id: p.id, name: p.name, ssids: p.ssids })), error: null };
    } catch (e) {
      return { portals: [], error: e instanceof Error ? e.message : String(e) };
    }
  });

export const listPortalMappings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { ecosystemId: string }) => {
    if (!data?.ecosystemId) throw new Error("A shop is required.");
    return data;
  })
  .handler(async ({ data, context }): Promise<PortalMappingView[]> => {
    await assertShopAdmin(context as unknown as AuthContext, data.ecosystemId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("omada_portal_mappings")
      .select("*")
      .eq("ecosystem_id", data.ecosystemId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return ((rows ?? []) as Array<Record<string, unknown>>).map(mappingView);
  });

export const savePortalMapping = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      ecosystemId: string;
      id?: string | null;
      siteId: string;
      siteName?: string | null;
      portalId: string;
      portalName?: string | null;
      ssidInfo?: string | null;
      enabled?: boolean;
      flags: Partial<PortalFeatureFlags>;
    }) => {
      if (!data?.ecosystemId) throw new Error("A shop is required.");
      if (!data?.siteId?.trim()) throw new Error("Choose the Omada site.");
      if (!data?.portalId?.trim()) {
        throw new Error("Choose the exact Omada portal this shop should serve.");
      }
      return data;
    },
  )
  .handler(async ({ data, context }): Promise<PortalMappingView> => {
    const ctx = context as unknown as AuthContext;
    await assertShopAdmin(ctx, data.ecosystemId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const payload = {
      ecosystem_id: data.ecosystemId,
      site_id: data.siteId.trim(),
      site_name: data.siteName?.trim() || null,
      portal_id: data.portalId.trim(),
      portal_name: data.portalName?.trim() || null,
      ssid_info: data.ssidInfo?.trim() || null,
      enabled: data.enabled !== false,
      settings: normalizePortalFlags(data.flags) as unknown as Record<string, boolean>,
      created_by: ctx.userId,
    };
    const { data: row, error } = await supabaseAdmin
      .from("omada_portal_mappings")
      .upsert(payload, { onConflict: "ecosystem_id,site_id,portal_id" })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return mappingView(row as Record<string, unknown>);
  });

export const setPortalMappingEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { ecosystemId: string; id: string; enabled: boolean }) => {
    if (!data?.ecosystemId || !data?.id) throw new Error("A shop and portal are required.");
    return data;
  })
  .handler(async ({ data, context }) => {
    await assertShopAdmin(context as unknown as AuthContext, data.ecosystemId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("omada_portal_mappings")
      .update({ enabled: data.enabled })
      .eq("id", data.id)
      .eq("ecosystem_id", data.ecosystemId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const deletePortalMapping = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { ecosystemId: string; id: string }) => {
    if (!data?.ecosystemId || !data?.id) throw new Error("A shop and portal are required.");
    return data;
  })
  .handler(async ({ data, context }) => {
    await assertShopAdmin(context as unknown as AuthContext, data.ecosystemId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("omada_portal_mappings")
      .delete()
      .eq("id", data.id)
      .eq("ecosystem_id", data.ecosystemId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export interface PortalTestStep {
  step: string;
  ok: boolean;
  detail: string;
}

/**
 * End-to-end check of ONE saved mapping against the live controller.
 *
 * Two independent outcomes are reported and stored separately:
 *  - can WaveWallet reach and read this shop's controller;
 *  - does the portal's External Portal Server really point at WaveWallet.
 * The second one is only ever "verified" when the controller reads that address
 * back. Nothing is written to the controller here.
 */
export const testPortalMapping = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { ecosystemId: string; id: string; portalUrl?: string | null }) => {
    if (!data?.ecosystemId || !data?.id) throw new Error("A shop and portal are required.");
    return data;
  })
  .handler(
    async ({
      data,
      context,
    }): Promise<{ ok: boolean; steps: PortalTestStep[]; externalStatus: string }> => {
      await assertShopAdmin(context as unknown as AuthContext, data.ecosystemId);
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { openOmadaSession } = await import("./omada-api.server");
      const { discoverPortalCapabilities, listSitePortals } = await import("./omada-portals.server");
      const { loadHotspotCredentials } = await import("./omada-hotspot.server");
    const { loadHotspotCredentials } = await import("./omada-hotspot.server");

      const steps: PortalTestStep[] = [];
      const { data: row } = await supabaseAdmin
        .from("omada_portal_mappings")
        .select("*")
        .eq("id", data.id)
        .eq("ecosystem_id", data.ecosystemId)
        .maybeSingle();
      if (!row) throw new Error("That portal mapping does not belong to this shop.");

      let ok = false;
      let externalStatus = "unknown";
      let externalDetail = "The External Portal Server setting was not checked.";
      try {
        const session = await openOmadaSession(supabaseAdmin as never, data.ecosystemId);
        steps.push({
          step: "Controller session",
          ok: true,
          detail: "Authenticated with this shop's own stored credentials.",
        });
        const caps = await discoverPortalCapabilities(session, {
        hotspotOperatorConfigured: Boolean(await loadHotspotCredentials(supabaseAdmin, ecosystemId)),
      });
        steps.push({
          step: "Controller capability",
          ok: caps.listSupported,
          detail: caps.notes.join(" "),
        });
        steps.push({
          step: "Automatic sign-on",
          ok: caps.authorizeSupported,
          detail: caps.authorizeSupported
            ? `Verified endpoint ${caps.authorizePath}.`
            : (caps.limitation ?? "Not published by this controller."),
        });
        const portals = await listSitePortals({ ...session, siteId: row.site_id as string }, caps);
        const match = portals.find((p) => p.id === row.portal_id);
        steps.push({
          step: "Portal still exists",
          ok: Boolean(match),
          detail: match
            ? `"${match.name}" found on site ${row.site_name ?? row.site_id}.`
            : `The selected portal is no longer present on this site (${portals.length} portal(s) found).`,
        });
        ok = Boolean(match) && caps.listSupported;

        // Read-only verification of the one-time Omada configuration.
        if (data.portalUrl) {
          const { readPortalConfig } = await import("./omada-auto-config.server");
          const { readbackMatchesExternalPortal } = await import("./omada-auto-config");
          const config = await readPortalConfig(
            session,
            row.site_id as string,
            row.portal_id as string,
          );
          if (!config) {
            externalStatus = "not_exposed";
            externalDetail =
              "This controller does not return the portal's authentication settings through its supported API, so WaveWallet cannot confirm the External Portal Server. Configure it once in Omada.";
          } else if (readbackMatchesExternalPortal(config, data.portalUrl)) {
            externalStatus = "verified";
            externalDetail = "The controller reports this portal's External Portal Server as the WaveWallet address.";
          } else if (config["authType"] === undefined && config["externalPortal"] === undefined) {
            externalStatus = "not_exposed";
            externalDetail =
              "This controller returns the portal without its authentication type, so the External Portal Server cannot be verified through the supported API. Configure it once in Omada.";
          } else {
            externalStatus = "not_configured";
            externalDetail =
              "The controller answered, but this portal does not point at the WaveWallet address yet.";
          }
          steps.push({
            step: "External portal configuration",
            ok: externalStatus === "verified",
            detail: externalDetail,
          });
        }
      } catch (e) {
        steps.push({
          step: "Controller session",
          ok: false,
          detail: e instanceof Error ? e.message : String(e),
        });
      }

      await supabaseAdmin
        .from("omada_portal_mappings")
        .update({
          last_test_status: ok ? "passed" : "failed",
          last_test_at: new Date().toISOString(),
          last_test_detail: steps.map((s) => `${s.step}: ${s.detail}`).join(" | ").slice(0, 900),
          ...(data.portalUrl
            ? {
                auto_config_status: externalStatus,
                auto_config_detail: externalDetail.slice(0, 900),
                auto_config_at: new Date().toISOString(),
                auto_config_url: data.portalUrl,
              }
            : {}),
        })
        .eq("id", data.id);

      return { ok, steps, externalStatus };
    },
  );


export interface AutoConfigResult {
  status: import("./omada-auto-config").AutoConfigStatus;
  summary: string;
  steps: PortalTestStep[];
  manualSteps: string[];
  portalUrl: string;
}

/**
 * Tries to configure ONE saved portal directly in the shop's own Omada
 * controller. The portal is only ever reported as configured when the
 * controller reads back WaveWallet's own address; otherwise the exact manual
 * steps are returned and the portal is left exactly as it was.
 */
export const autoConfigurePortal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { ecosystemId: string; id: string; portalUrl: string }) => {
    if (!data?.ecosystemId || !data?.id) throw new Error("A shop and portal are required.");
    if (!/^https?:\/\/.+/.test(data?.portalUrl ?? "")) throw new Error("A portal address is required.");
    return data;
  })
  .handler(async ({ data, context }): Promise<AutoConfigResult> => {
    await assertShopAdmin(context as unknown as AuthContext, data.ecosystemId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { openOmadaSession } = await import("./omada-api.server");
    const { applyExternalPortal } = await import("./omada-auto-config.server");
    const { manualPortalSteps, summarizeAutoConfig } = await import("./omada-auto-config");

    const { data: row } = await supabaseAdmin
      .from("omada_portal_mappings")
      .select("*")
      .eq("id", data.id)
      .eq("ecosystem_id", data.ecosystemId)
      .maybeSingle();
    if (!row) throw new Error("That portal mapping does not belong to this shop.");

    const manual = manualPortalSteps(data.portalUrl, (row.portal_name as string | null) ?? null);
    try {
      const session = await openOmadaSession(supabaseAdmin as never, data.ecosystemId);
      const outcome = await applyExternalPortal(
        session,
        row.site_id as string,
        row.portal_id as string,
        data.portalUrl,
      );
      await supabaseAdmin
        .from("omada_portal_mappings")
        .update({
          auto_config_status: outcome.status,
          auto_config_url: data.portalUrl,
          auto_config_at: new Date().toISOString(),
          auto_config_detail: outcome.steps
            .map((s) => `${s.step}: ${s.detail}`)
            .join(" | ")
            .slice(0, 900),
          auto_config_snapshot: outcome.snapshot as never,
        })
        .eq("id", data.id)
        .eq("ecosystem_id", data.ecosystemId);
      return {
        status: outcome.status,
        summary: summarizeAutoConfig(outcome.status),
        steps: outcome.steps,
        manualSteps:
          outcome.status === "configured" || outcome.status === "already_configured" ? [] : manual,
        portalUrl: data.portalUrl,
      };
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      return {
        status: "failed",
        summary: summarizeAutoConfig("failed"),
        steps: [{ step: "Controller session", ok: false, detail }],
        manualSteps: manual,
        portalUrl: data.portalUrl,
      };
    }
  });
