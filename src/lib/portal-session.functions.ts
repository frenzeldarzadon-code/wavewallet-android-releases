/**
 * The customer side of the WaveWallet captive portal.
 *
 * The visitor arrives from an Omada hotspot with no WaveWallet session at all,
 * so the first two calls are deliberately public. They are safe because:
 *  - the shop is resolved SERVER-SIDE from a saved portal mapping, never from
 *    anything the browser sends beyond the opaque portal identifiers;
 *  - only public catalogue fields (name, description, price, availability) are
 *    ever returned, never wallets, members, codes or history;
 *  - anything that spends money runs as the SIGNED-IN customer through the
 *    existing Voucher Shop purchase logic, not here.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  durationMinutesFromCalibration,
  normalizePortalFlags,
  parsePortalParams,
  resolveMapping,
  type MappingCandidate,
  type PortalFeatureFlags,
} from "./portal-mapping";

type AuthContext = {
  supabase: {
    rpc: (fn: string, args: unknown) => Promise<{ data: unknown; error: { message: string } | null }>;
  };
  userId: string;
};

export interface PortalProduct {
  id: string;
  name: string;
  description: string | null;
  price: number;
  pointsPrice: number | null;
  available: number;
  /** Access length from this shop's own Omada calibration, or null when absent. */
  durationMinutes: number | null;
}

export interface PortalState {
  sessionId: string;
  shopId: string;
  shopName: string;
  shopSlug: string | null;
  /** Public 7-digit Shop ID, used only to build this shop's own auth links. */
  shopCode: string | null;
  portalName: string | null;
  ssid: string | null;
  flags: PortalFeatureFlags;
  /** Automatic sign-on availability of this shop's controller. */
  autoSignOn: boolean;
  autoSignOnNote: string | null;
  /** Present only when Omada told us which device is asking. */
  hasClient: boolean;
  redirectUrl: string | null;
  products: PortalProduct[];
}

export interface PortalStartFailure {
  ok: false;
  reason: string;
}

async function loadState(
  supabaseAdmin: {
    from: (t: string) => any;
  },
  sessionRow: Record<string, unknown>,
  mapping: Record<string, unknown>,
): Promise<PortalState> {
  const ecosystemId = String(sessionRow["ecosystem_id"]);
  const [{ data: shop }, { data: products }, { data: calibrations }] = await Promise.all([
    supabaseAdmin.from("ecosystems").select("id, name, slug, shop_code").eq("id", ecosystemId).maybeSingle(),
    supabaseAdmin
      .from("voucher_products")
      .select("id, name, description, credit_price, points_price, promo_price")
      .eq("ecosystem_id", ecosystemId)
      .eq("active", true)
      .eq("archived", false)
      .order("credit_price", { ascending: true }),
    supabaseAdmin
      .from("omada_voucher_calibrations")
      .select("product_id, payload")
      .eq("ecosystem_id", ecosystemId)
      .eq("is_current", true),
  ]);

  const productRows = (products ?? []) as Array<Record<string, unknown>>;
  const durations = new Map<string, number | null>();
  for (const row of (calibrations ?? []) as Array<Record<string, unknown>>) {
    durations.set(String(row["product_id"]), durationMinutesFromCalibration(row["payload"]));
  }

  const stock = new Map<string, number>();
  if (productRows.length > 0) {
    const { data: codes } = await supabaseAdmin
      .from("voucher_codes")
      .select("product_id")
      .eq("ecosystem_id", ecosystemId)
      .eq("status", "unused");
    for (const row of (codes ?? []) as Array<{ product_id: string }>) {
      stock.set(row.product_id, (stock.get(row.product_id) ?? 0) + 1);
    }
  }

  const autoSignOn = Boolean((mapping["settings"] as Record<string, unknown> | null)?.["autoSignOn"]);

  return {
    sessionId: String(sessionRow["id"]),
    shopId: ecosystemId,
    shopName: String((shop as Record<string, unknown> | null)?.["name"] ?? "This shop"),
    shopSlug: ((shop as Record<string, unknown> | null)?.["slug"] as string | null) ?? null,
    shopCode: ((shop as Record<string, unknown> | null)?.["shop_code"] as string | null) ?? null,
    portalName: (mapping["portal_name"] as string | null) ?? null,
    ssid: (sessionRow["ssid"] as string | null) ?? (mapping["ssid_info"] as string | null) ?? null,
    flags: normalizePortalFlags(mapping["settings"]),
    autoSignOn,
    autoSignOnNote: null,
    hasClient: Boolean(sessionRow["client_mac"]),
    redirectUrl: (sessionRow["redirect_url"] as string | null) ?? null,
    products: productRows.map((p) => ({
      id: String(p["id"]),
      name: String(p["name"]),
      description: (p["description"] as string | null) ?? null,
      price: Number(p["promo_price"] ?? p["credit_price"] ?? 0),
      pointsPrice: p["points_price"] === null || p["points_price"] === undefined ? null : Number(p["points_price"]),
      available: stock.get(String(p["id"])) ?? 0,
      durationMinutes: durations.get(String(p["id"])) ?? null,
    })),
  };
}

/** Resolve the shop from the Omada redirect and open a short-lived session. */
export const startPortalSession = createServerFn({ method: "POST" })
  .inputValidator((data: { search: Record<string, string> }) => {
    if (!data || typeof data.search !== "object") throw new Error("Missing portal parameters.");
    return data;
  })
  .handler(async ({ data }): Promise<PortalState | PortalStartFailure> => {
    const params = parsePortalParams(data.search);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // A customized Omada page already handed its client context to
    // /api/public/portal-context and got a session back. Re-use that exact
    // session instead of opening a second one for the same device.
    const handed = (data.search["wwSession"] ?? "").trim();
    if (handed) {
      try {
        const existing = await requireSession(handed);
        return loadState(supabaseAdmin as never, existing.row, existing.mapping);
      } catch {
        // Expired or unknown: fall through and start a fresh session below.
      }
    }


    let query = supabaseAdmin.from("omada_portal_mappings").select("*");
    query = params.mappingId
      ? query.eq("id", params.mappingId)
      : query.eq("site_id", params.siteRef ?? "");
    const { data: rows } = await query;
    const mappings = (rows ?? []) as Array<Record<string, unknown>>;
    const candidates: MappingCandidate[] = mappings.map((m) => ({
      id: String(m["id"]),
      ecosystemId: String(m["ecosystem_id"]),
      siteId: String(m["site_id"]),
      siteName: (m["site_name"] as string | null) ?? null,
      portalId: String(m["portal_id"]),
      portalName: (m["portal_name"] as string | null) ?? null,
      ssidInfo: (m["ssid_info"] as string | null) ?? null,
      enabled: m["enabled"] !== false,
    }));
    const resolved = resolveMapping(candidates, params);
    if (!resolved.ok) return { ok: false, reason: resolved.reason };
    const mapping = mappings.find((m) => String(m["id"]) === resolved.mapping.id)!;

    const { data: sessionRow, error } = await supabaseAdmin
      .from("portal_sessions")
      .insert({
        mapping_id: resolved.mapping.id,
        ecosystem_id: resolved.mapping.ecosystemId,
        client_mac: params.clientMac,
        ap_mac: params.apMac,
        ssid: params.ssidName,
        radio_id: params.radioId,
        site_ref: params.siteRef ?? resolved.mapping.siteId,
        redirect_url: params.redirectUrl,
      })
      .select("*")
      .single();
    if (error) return { ok: false, reason: "This hotspot session could not be started." };

    return loadState(supabaseAdmin as never, sessionRow as Record<string, unknown>, mapping);
  });

async function requireSession(sessionId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: row } = await supabaseAdmin
    .from("portal_sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle();
  if (!row) throw new Error("This hotspot session is no longer valid. Reconnect to the Wi-Fi.");
  if (new Date(row.expires_at as string).getTime() < Date.now()) {
    throw new Error("This hotspot session has expired. Reconnect to the Wi-Fi to start again.");
  }
  const { data: mapping } = await supabaseAdmin
    .from("omada_portal_mappings")
    .select("*")
    .eq("id", row.mapping_id as string)
    .maybeSingle();
  if (!mapping || mapping.enabled === false) {
    throw new Error("This hotspot portal is currently switched off by the shop.");
  }
  return { supabaseAdmin, row: row as Record<string, unknown>, mapping: mapping as Record<string, unknown> };
}

/** Refresh the portal view — used after signing in or after a purchase. */
export const getPortalState = createServerFn({ method: "POST" })
  .inputValidator((data: { sessionId: string }) => {
    if (!data?.sessionId) throw new Error("Missing hotspot session.");
    return data;
  })
  .handler(async ({ data }): Promise<PortalState> => {
    const { supabaseAdmin, row, mapping } = await requireSession(data.sessionId);
    return loadState(supabaseAdmin as never, row, mapping);
  });

export interface AuthorizeResult {
  ok: boolean;
  authorizationId: string | null;
  code: string | null;
  durationMinutes: number | null;
  message: string;
  redirectUrl: string | null;
}

async function performAuthorization(opts: {
  supabaseAdmin: any;
  session: Record<string, unknown>;
  ecosystemId: string;
  code: string;
  durationMinutes: number;
  memberId: string | null;
  saleId: string | null;
  existingId?: string;
}): Promise<AuthorizeResult> {
  const { supabaseAdmin, session, ecosystemId, code, durationMinutes } = opts;
  const clientMac = session["client_mac"] as string | null;

  const record = async (status: string, error: string | null) => {
    if (opts.existingId) {
      await supabaseAdmin
        .from("portal_authorizations")
        .update({
          status,
          error,
          authorized_at: status === "authorized" ? new Date().toISOString() : null,
        })
        .eq("id", opts.existingId);
      return opts.existingId;
    }
    const { data: inserted } = await supabaseAdmin
      .from("portal_authorizations")
      .insert({
        session_id: session["id"],
        ecosystem_id: ecosystemId,
        member_id: opts.memberId,
        sale_id: opts.saleId,
        voucher_code: code,
        duration_minutes: durationMinutes,
        status,
        error,
        authorized_at: status === "authorized" ? new Date().toISOString() : null,
      })
      .select("id")
      .single();
    return inserted ? String(inserted.id) : null;
  };

  if (!clientMac) {
    const id = await record(
      "failed",
      "Omada did not identify the connecting device for this session.",
    );
    return {
      ok: false,
      authorizationId: id,
      code,
      durationMinutes,
      message:
        "Your voucher is ready, but this hotspot page did not tell us which device is connecting. Enter the code on the hotspot login page to go online.",
      redirectUrl: (session["redirect_url"] as string | null) ?? null,
    };
  }

  const { openOmadaSession } = await import("./omada-api.server");
  const { discoverPortalCapabilities, authorizePortalClient } = await import("./omada-portals.server");
  try {
    const omada = await openOmadaSession(supabaseAdmin, ecosystemId);
    const caps = await discoverPortalCapabilities(omada);
    await authorizePortalClient(omada, caps, {
      clientMac,
      apMac: (session["ap_mac"] as string | null) ?? null,
      ssidName: (session["ssid"] as string | null) ?? null,
      radioId: (session["radio_id"] as string | null) ?? null,
      durationMs: durationMinutes * 60_000,
      voucherCode: code,
    });
    const id = await record("authorized", null);
    return {
      ok: true,
      authorizationId: id,
      code,
      durationMinutes,
      message: "You are online.",
      redirectUrl: (session["redirect_url"] as string | null) ?? null,
    };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    const id = await record("failed", detail.slice(0, 500));
    return {
      ok: false,
      authorizationId: id,
      code,
      durationMinutes,
      message: detail,
      redirectUrl: (session["redirect_url"] as string | null) ?? null,
    };
  }
}

/**
 * Manual voucher entry — unchanged for customers with no WaveWallet account.
 * The code is handed to the controller exactly as typed; WaveWallet never
 * validates or consumes it itself.
 */
export const authorizeManualVoucher = createServerFn({ method: "POST" })
  .inputValidator((data: { sessionId: string; code: string }) => {
    if (!data?.sessionId) throw new Error("Missing hotspot session.");
    const code = (data.code ?? "").trim();
    if (!code || code.length > 32) throw new Error("Enter your voucher code.");
    return { sessionId: data.sessionId, code };
  })
  .handler(async ({ data }): Promise<AuthorizeResult> => {
    const { supabaseAdmin, row } = await requireSession(data.sessionId);
    const { data: recent } = await supabaseAdmin
      .from("portal_authorizations")
      .select("id")
      .eq("session_id", data.sessionId)
      .gte("created_at", new Date(Date.now() - 60_000).toISOString());
    if ((recent ?? []).length >= 8) {
      throw new Error("Too many attempts. Wait a moment and try again.");
    }
    // Omada owns the voucher's own validity and remaining time.
    return performAuthorization({
      supabaseAdmin,
      session: row,
      ecosystemId: String(row["ecosystem_id"]),
      code: data.code,
      durationMinutes: 0,
      memberId: null,
      saleId: null,
    });
  });

/** Binds the signed-in customer to this hotspot session. */
export const claimPortalSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { sessionId: string }) => {
    if (!data?.sessionId) throw new Error("Missing hotspot session.");
    return data;
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as AuthContext;
    const { supabaseAdmin, row } = await requireSession(data.sessionId);
    await supabaseAdmin
      .from("portal_sessions")
      .update({ member_id: ctx.userId })
      .eq("id", data.sessionId);
    const member = await ctx.supabase.rpc("has_membership", {
      _user_id: ctx.userId,
      _ecosystem_id: String(row["ecosystem_id"]),
    });
    if (member.error) throw new Error(member.error.message);
    return { ok: true as const, isMember: member.data === true };
  });

/**
 * Puts the customer's device online using a voucher they ALREADY bought through
 * the shop's existing Voucher Shop. This never creates or prices a voucher: it
 * reads the completed sale and uses the code that sale assigned.
 */
export const authorizePortalSale = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { sessionId: string; saleId: string }) => {
    if (!data?.sessionId || !data?.saleId) throw new Error("Missing purchase details.");
    return data;
  })
  .handler(async ({ data, context }): Promise<AuthorizeResult> => {
    const ctx = context as unknown as AuthContext;
    const { supabaseAdmin, row } = await requireSession(data.sessionId);
    const ecosystemId = String(row["ecosystem_id"]);

    const { data: sale } = await supabaseAdmin
      .from("voucher_sales")
      .select("id, ecosystem_id, buyer_id, product_id")
      .eq("id", data.saleId)
      .maybeSingle();
    if (!sale || sale.buyer_id !== ctx.userId || sale.ecosystem_id !== ecosystemId) {
      throw new Error("That purchase does not belong to this hotspot session.");
    }

    const { data: existing } = await supabaseAdmin
      .from("portal_authorizations")
      .select("id, status")
      .eq("sale_id", data.saleId)
      .eq("status", "authorized")
      .maybeSingle();
    if (existing) {
      return {
        ok: true,
        authorizationId: String(existing.id),
        code: null,
        durationMinutes: null,
        message: "This voucher is already active on your device.",
        redirectUrl: (row["redirect_url"] as string | null) ?? null,
      };
    }

    const { data: codeRow } = await supabaseAdmin
      .from("voucher_codes")
      .select("code")
      .eq("sale_id", data.saleId)
      .eq("ecosystem_id", ecosystemId)
      .limit(1)
      .maybeSingle();
    if (!codeRow) throw new Error("That purchase has no voucher code yet.");

    const { data: calibration } = await supabaseAdmin
      .from("omada_voucher_calibrations")
      .select("payload")
      .eq("ecosystem_id", ecosystemId)
      .eq("product_id", sale.product_id as string)
      .eq("is_current", true)
      .maybeSingle();
    const minutes = durationMinutesFromCalibration(
      (calibration as { payload?: unknown } | null)?.payload,
    );

    return performAuthorization({
      supabaseAdmin,
      session: row,
      ecosystemId,
      code: String(codeRow.code),
      durationMinutes: minutes ?? 0,
      memberId: ctx.userId,
      saleId: data.saleId,
    });
  });

/** Retries a failed sign-on without charging the customer again. */
export const retryPortalAuthorization = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { sessionId: string; authorizationId: string }) => {
    if (!data?.sessionId || !data?.authorizationId) throw new Error("Nothing to retry.");
    return data;
  })
  .handler(async ({ data, context }): Promise<AuthorizeResult> => {
    const ctx = context as unknown as AuthContext;
    const { supabaseAdmin, row } = await requireSession(data.sessionId);
    const { data: attempt } = await supabaseAdmin
      .from("portal_authorizations")
      .select("*")
      .eq("id", data.authorizationId)
      .eq("session_id", data.sessionId)
      .maybeSingle();
    if (!attempt) throw new Error("That sign-on attempt is not part of this hotspot session.");
    if (attempt.member_id && attempt.member_id !== ctx.userId) {
      throw new Error("That sign-on attempt belongs to another customer.");
    }
    return performAuthorization({
      supabaseAdmin,
      session: row,
      ecosystemId: String(row["ecosystem_id"]),
      code: String(attempt.voucher_code ?? ""),
      durationMinutes: Number(attempt.duration_minutes ?? 0),
      memberId: (attempt.member_id as string | null) ?? null,
      saleId: (attempt.sale_id as string | null) ?? null,
      existingId: String(attempt.id),
    });
  });
