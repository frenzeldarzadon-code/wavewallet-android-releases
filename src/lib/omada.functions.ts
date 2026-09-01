/**
 * Tenant-scoped Omada integration.
 *
 * Every function authorises the signed-in user as an admin of the shop the
 * request names (or as the platform owner, for support metadata only), then
 * reads/writes ONLY that shop's row. Client secrets are encrypted at rest and
 * never returned to the browser.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface OmadaConnectionView {
  configured: boolean;
  baseUrl: string;
  omadacId: string;
  clientId: string;
  siteName: string;
  siteId: string | null;
  lastStatus: "untested" | "connected" | "failed" | string;
  lastCheckedAt: string | null;
  lastError: string | null;
  /** Masked hint only — the secret itself never leaves the server. */
  hasClientSecret: boolean;
  /** Hotspot Operator sign-in used by the external-portal authorization API. */
  hotspotOperatorUser: string;
  hasHotspotOperatorSecret: boolean;
}

const EMPTY: OmadaConnectionView = {
  configured: false,
  baseUrl: "",
  omadacId: "",
  clientId: "",
  siteName: "",
  siteId: null,
  lastStatus: "untested",
  lastCheckedAt: null,
  lastError: null,
  hasClientSecret: false,
  hotspotOperatorUser: "",
  hasHotspotOperatorSecret: false,
};

type AuthContext = { supabase: { rpc: (fn: string, args: unknown) => Promise<{ data: unknown; error: { message: string } | null }> }; userId: string };

/** Throws unless the caller administers this shop. Super Admin is allowed. */
async function assertShopAdmin(context: AuthContext, ecosystemId: string) {
  const { supabase, userId } = context;
  const owner = await supabase.rpc("is_super_admin", { _user_id: userId });
  if (owner.error) throw new Error(owner.error.message);
  if (owner.data === true) return;
  const admin = await supabase.rpc("is_ecosystem_admin", {
    _user_id: userId,
    _ecosystem_id: ecosystemId,
  });
  if (admin.error) throw new Error(admin.error.message);
  if (admin.data !== true) throw new Error("You can only manage the Omada connection of your own shop.");
}

function view(row: Record<string, unknown> | null): OmadaConnectionView {
  if (!row) return EMPTY;
  return {
    configured: true,
    baseUrl: String(row["base_url"] ?? ""),
    omadacId: String(row["omadac_id"] ?? ""),
    clientId: String(row["client_id"] ?? ""),
    siteName: String(row["site_name"] ?? ""),
    siteId: (row["site_id"] as string | null) ?? null,
    lastStatus: String(row["last_status"] ?? "untested"),
    lastCheckedAt: (row["last_checked_at"] as string | null) ?? null,
    lastError: (row["last_error"] as string | null) ?? null,
    hasClientSecret: Boolean(row["client_secret_ciphertext"]),
    hotspotOperatorUser: String(row["hotspot_operator_user"] ?? ""),
    hasHotspotOperatorSecret: Boolean(row["hotspot_operator_secret_ciphertext"]),
  };
}

export const getOmadaConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { ecosystemId: string }) => {
    if (!data?.ecosystemId) throw new Error("A shop is required.");
    return data;
  })
  .handler(async ({ data, context }): Promise<OmadaConnectionView> => {
    await assertShopAdmin(context as unknown as AuthContext, data.ecosystemId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("omada_connections")
      .select("*")
      .eq("ecosystem_id", data.ecosystemId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (row) return view(row as Record<string, unknown>);

    // Only pre-provisioned shops (their own, already-verified controller) get
    // a row created for them; every other tenant stays unconfigured.
    const { bootstrapProvisionedConnection, provisioningFor } = await import(
      "./omada-provisioning.server"
    );
    const seeded = await bootstrapProvisionedConnection(supabaseAdmin, data.ecosystemId);
    if (seeded) return view(seeded);

    // Secret not available yet: still prefill this shop's own non-secret
    // controller identity so its admin never retypes it.
    const spec = await provisioningFor(supabaseAdmin, data.ecosystemId);
    if (spec) {
      return {
        ...EMPTY,
        baseUrl: spec.baseUrl,
        omadacId: spec.omadacId,
        clientId: spec.clientId,
        siteName: spec.siteName,
      };
    }
    return EMPTY;
  });


export const saveOmadaConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      ecosystemId: string;
      baseUrl: string;
      omadacId: string;
      clientId: string;
      clientSecret: string;
      siteName: string;
      hotspotOperatorUser?: string;
      hotspotOperatorPassword?: string;
    }) => {
      if (!data?.ecosystemId) throw new Error("A shop is required.");
      const baseUrl = data.baseUrl?.trim() ?? "";
      if (!/^https:\/\/[^\s]+$/i.test(baseUrl)) {
        throw new Error("The controller address must be a full https:// URL.");
      }
      if (!data.omadacId?.trim()) throw new Error("Omada ID is required.");
      if (!data.clientId?.trim()) throw new Error("Client ID is required.");
      return {
        ecosystemId: data.ecosystemId,
        baseUrl,
        omadacId: data.omadacId.trim(),
        clientId: data.clientId.trim(),
        clientSecret: data.clientSecret ?? "",
        siteName: data.siteName?.trim() ?? "",
        hotspotOperatorUser: data.hotspotOperatorUser?.trim() ?? "",
        hotspotOperatorPassword: data.hotspotOperatorPassword ?? "",
      };
    },
  )
  .handler(async ({ data, context }): Promise<OmadaConnectionView> => {
    await assertShopAdmin(context as unknown as AuthContext, data.ecosystemId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { encryptSecret } = await import("./omada-crypto.server");

    const { data: existing } = await supabaseAdmin
      .from("omada_connections")
      .select("client_secret_ciphertext, hotspot_operator_secret_ciphertext")
      .eq("ecosystem_id", data.ecosystemId)
      .maybeSingle();

    // An empty secret field means "keep the stored one" on an update.
    const ciphertext = data.clientSecret
      ? encryptSecret(data.clientSecret)
      : ((existing?.client_secret_ciphertext as string | undefined) ?? "");
    if (!ciphertext) throw new Error("Client Secret is required the first time you connect.");

    // Same rule for the Hotspot Operator password: blank keeps the stored one.
    const operatorCipher = data.hotspotOperatorPassword
      ? encryptSecret(data.hotspotOperatorPassword)
      : ((existing?.hotspot_operator_secret_ciphertext as string | undefined) ?? null);
    if (data.hotspotOperatorUser && !operatorCipher) {
      throw new Error("A Hotspot Operator password is required the first time you save that username.");
    }

    const { data: row, error } = await supabaseAdmin
      .from("omada_connections")
      .upsert(
        {
          ecosystem_id: data.ecosystemId,
          base_url: data.baseUrl,
          omadac_id: data.omadacId,
          client_id: data.clientId,
          client_secret_ciphertext: ciphertext,
          site_name: data.siteName || null,
          hotspot_operator_user: data.hotspotOperatorUser || null,
          hotspot_operator_secret_ciphertext: data.hotspotOperatorUser ? operatorCipher : null,
          last_status: "untested",
          last_error: null,
          // New credentials invalidate any cached API session and reset health.
          access_token_ciphertext: null,
          token_expires_at: null,
          health_state: "unknown",
          consecutive_failures: 0,
          offline_since: null,
          last_failure_reason: null,
          next_check_at: new Date().toISOString(),
          created_by: (context as unknown as AuthContext).userId,
        },
        { onConflict: "ecosystem_id" },
      )
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return view(row as Record<string, unknown>);
  });

export const testOmadaConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { ecosystemId: string }) => {
    if (!data?.ecosystemId) throw new Error("A shop is required.");
    return data;
  })
  .handler(async ({ data, context }) => {
    await assertShopAdmin(context as unknown as AuthContext, data.ecosystemId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { decryptSecret } = await import("./omada-crypto.server");
    const { checkOmadaConnection } = await import("./omada.server");

    const { data: row, error } = await supabaseAdmin
      .from("omada_connections")
      .select("*")
      .eq("ecosystem_id", data.ecosystemId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Save your Omada details before testing the connection.");

    const report = await checkOmadaConnection({
      baseUrl: row.base_url as string,
      omadacId: row.omadac_id as string,
      clientId: row.client_id as string,
      clientSecret: decryptSecret(row.client_secret_ciphertext as string),
      siteName: row.site_name as string | null,
    });

    await supabaseAdmin
      .from("omada_connections")
      .update({
        last_status: report.ok ? "connected" : "failed",
        last_checked_at: new Date().toISOString(),
        last_error: report.error,
        site_id: report.siteId,
      })
      .eq("ecosystem_id", data.ecosystemId);

    return report;
  });

export const disconnectOmada = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { ecosystemId: string }) => {
    if (!data?.ecosystemId) throw new Error("A shop is required.");
    return data;
  })
  .handler(async ({ data, context }) => {
    await assertShopAdmin(context as unknown as AuthContext, data.ecosystemId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("omada_connections")
      .delete()
      .eq("ecosystem_id", data.ecosystemId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

/* ------------------------------------------------------------------ *
 * Health monitoring (tenant-scoped)
 *
 * WaveWallet can detect and automatically recover the API *session* to a
 * tenant's controller. It cannot restart the operator's Omada server: there is
 * no server-management connector (SSH/systemd/agent) in this project, so a
 * genuinely down controller still needs server-level action by its owner.
 * ------------------------------------------------------------------ */

export interface OmadaHealthView {
  configured: boolean;
  monitoringEnabled: boolean;
  state: "unknown" | "healthy" | "unreachable" | "auth_failed" | "degraded";
  reason: string | null;
  consecutiveFailures: number;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailureReason: string | null;
  offlineSince: string | null;
  lastRecoveredAt: string | null;
  nextCheckAt: string | null;
  /** True once downtime passes the warning threshold. */
  offlineTooLong: boolean;
}

const HEALTH_COLUMNS =
  "ecosystem_id, base_url, omadac_id, client_id, client_secret_ciphertext, site_name, access_token_ciphertext, token_expires_at, health_state, consecutive_failures, offline_since, monitoring_enabled, next_check_at, last_checked_at, last_success_at, last_failure_at, last_failure_reason, last_recovered_at";

function healthView(row: Record<string, unknown> | null, offlineWarn: boolean): OmadaHealthView {
  if (!row) {
    return {
      configured: false,
      monitoringEnabled: false,
      state: "unknown",
      reason: null,
      consecutiveFailures: 0,
      lastCheckedAt: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      lastFailureReason: null,
      offlineSince: null,
      lastRecoveredAt: null,
      nextCheckAt: null,
      offlineTooLong: false,
    };
  }
  return {
    configured: true,
    monitoringEnabled: Boolean(row["monitoring_enabled"]),
    state: (row["health_state"] as OmadaHealthView["state"]) ?? "unknown",
    reason: (row["last_failure_reason"] as string | null) ?? null,
    consecutiveFailures: Number(row["consecutive_failures"] ?? 0),
    lastCheckedAt: (row["last_checked_at"] as string | null) ?? null,
    lastSuccessAt: (row["last_success_at"] as string | null) ?? null,
    lastFailureAt: (row["last_failure_at"] as string | null) ?? null,
    lastFailureReason: (row["last_failure_reason"] as string | null) ?? null,
    offlineSince: (row["offline_since"] as string | null) ?? null,
    lastRecoveredAt: (row["last_recovered_at"] as string | null) ?? null,
    nextCheckAt: (row["next_check_at"] as string | null) ?? null,
    offlineTooLong: offlineWarn,
  };
}

/**
 * Current health for one shop. When that shop's own check is due it is run
 * inline (respecting the backoff), so an admin opening the page always sees a
 * fresh state without hammering the controller.
 */
export const getOmadaHealth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { ecosystemId: string; force?: boolean }) => {
    if (!data?.ecosystemId) throw new Error("A shop is required.");
    return { ecosystemId: data.ecosystemId, force: data.force === true };
  })
  .handler(async ({ data, context }): Promise<OmadaHealthView> => {
    await assertShopAdmin(context as unknown as AuthContext, data.ecosystemId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { runOmadaHealthCheck, offlineTooLong } = await import("./omada-health.server");

    const read = async () =>
      supabaseAdmin
        .from("omada_connections")
        .select(HEALTH_COLUMNS)
        .eq("ecosystem_id", data.ecosystemId)
        .maybeSingle();

    const { data: row, error } = await read();
    if (error) throw new Error(error.message);
    if (!row) return healthView(null, false);

    const due =
      Boolean(row["monitoring_enabled"]) &&
      new Date(String(row["next_check_at"] ?? 0)).getTime() <= Date.now();

    if (data.force || due) {
      try {
        await runOmadaHealthCheck(supabaseAdmin as never, row as never);
        const again = await read();
        const fresh = (again.data ?? row) as Record<string, unknown>;
        return healthView(fresh, offlineTooLong(fresh["offline_since"] as string | null));
      } catch {
        /* fall through to the stored state */
      }
    }
    const stored = row as Record<string, unknown>;
    return healthView(stored, offlineTooLong(stored["offline_since"] as string | null));
  });

/** Turn periodic monitoring on/off for this shop only. */
export const setOmadaMonitoring = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { ecosystemId: string; enabled: boolean }) => {
    if (!data?.ecosystemId) throw new Error("A shop is required.");
    return { ecosystemId: data.ecosystemId, enabled: Boolean(data.enabled) };
  })
  .handler(async ({ data, context }) => {
    await assertShopAdmin(context as unknown as AuthContext, data.ecosystemId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("omada_connections")
      .update({
        monitoring_enabled: data.enabled,
        next_check_at: new Date().toISOString(),
      })
      .eq("ecosystem_id", data.ecosystemId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
