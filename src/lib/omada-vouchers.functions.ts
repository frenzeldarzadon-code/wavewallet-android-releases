/**
 * Omada voucher operations, always scoped to ONE shop.
 *
 * Generation is admin-only; voucher status lookup is open to any member of that
 * same shop. No credential, token or controller address ever leaves the server.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { OmadaFieldSpec } from "./omada-vouchers.server";
import { toVoucherView, type VoucherView } from "./omada-voucher-view";

/** Controller rows are flattened to plain display values before crossing to the browser. */
export type OmadaRow = Record<string, string | number | boolean | null>;

function flatten(row: Record<string, unknown>): OmadaRow {
  const out: OmadaRow = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === null || v === undefined) out[k] = null;
    else if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k] = v;
    else out[k] = JSON.stringify(v);
  }
  return out;
}

type AuthContext = {
  supabase: {
    rpc: (fn: string, args: unknown) => Promise<{ data: unknown; error: { message: string } | null }>;
  };
  userId: string;
};

async function isOwner(context: AuthContext) {
  const owner = await context.supabase.rpc("is_super_admin", { _user_id: context.userId });
  if (owner.error) throw new Error(owner.error.message);
  return owner.data === true;
}

async function assertShopAdmin(context: AuthContext, ecosystemId: string) {
  if (await isOwner(context)) return;
  const admin = await context.supabase.rpc("is_ecosystem_admin", {
    _user_id: context.userId,
    _ecosystem_id: ecosystemId,
  });
  if (admin.error) throw new Error(admin.error.message);
  if (admin.data !== true) throw new Error("Only this shop's admin can generate Omada vouchers.");
}

async function assertShopMember(context: AuthContext, ecosystemId: string) {
  if (await isOwner(context)) return;
  const member = await context.supabase.rpc("has_membership", {
    _user_id: context.userId,
    _ecosystem_id: ecosystemId,
  });
  if (member.error) throw new Error(member.error.message);
  if (member.data !== true) throw new Error("You are not a member of this shop.");
}

function friendly(e: unknown): never {
  const message = e instanceof Error ? e.message : String(e);
  throw new Error(message);
}

export interface OmadaVoucherSetup {
  configured: boolean;
  supported: boolean;
  limitation: string | null;
  fields: OmadaFieldSpec[];
  /** Existing groups on the controller, used as calibration reference. */
  groups: OmadaRow[];
  error: string | null;
}

/** Admin: the controller's own voucher schema + existing groups. */
export const getOmadaVoucherSetup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { ecosystemId: string }) => {
    if (!data?.ecosystemId) throw new Error("A shop is required.");
    return data;
  })
  .handler(async ({ data, context }): Promise<OmadaVoucherSetup> => {
    await assertShopAdmin(context as unknown as AuthContext, data.ecosystemId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { openOmadaSession } = await import("./omada-api.server");
    const { loadOmadaSpec, voucherCapabilities, listVoucherGroups } = await import(
      "./omada-vouchers.server"
    );
    const base: OmadaVoucherSetup = {
      configured: false,
      supported: false,
      limitation: null,
      fields: [],
      groups: [],
      error: null,
    };
    try {
      const session = await openOmadaSession(supabaseAdmin as never, data.ecosystemId);
      const caps = voucherCapabilities(await loadOmadaSpec(session));
      let groups: OmadaRow[] = [];
      try {
        groups = (await listVoucherGroups(session, caps)).map(flatten);
      } catch {
        /* listing is best-effort; generation may still work */
      }
      return {
        ...base,
        configured: true,
        supported: caps.supported,
        limitation: caps.limitation,
        fields: caps.fields,
        groups,
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (message.includes("no Omada controller connected")) return base;
      return { ...base, configured: true, error: message };
    }
  });

/** Admin: send the reviewed payload to this shop's own controller. */
export const generateOmadaVouchers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { ecosystemId: string; payload: Record<string, unknown> }) => {
    if (!data?.ecosystemId) throw new Error("A shop is required.");
    if (!data.payload || typeof data.payload !== "object") throw new Error("Nothing to send.");
    return data;
  })
  .handler(async ({ data, context }) => {
    await assertShopAdmin(context as unknown as AuthContext, data.ecosystemId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { openOmadaSession } = await import("./omada-api.server");
    const { loadOmadaSpec, voucherCapabilities, createVoucherGroup, validateAgainstSpec } =
      await import("./omada-vouchers.server");

    try {
      const session = await openOmadaSession(supabaseAdmin as never, data.ecosystemId);
      const caps = voucherCapabilities(await loadOmadaSpec(session));
      if (!caps.supported) throw new Error(caps.limitation ?? "Voucher generation is unavailable.");

      const problems = validateAgainstSpec(caps.fields, data.payload);
      if (problems.length > 0) throw new Error(problems.join(" "));

      const result = await createVoucherGroup(session, caps, data.payload);
      const groupId =
        (result["id"] as string | undefined) ??
        (result["groupId"] as string | undefined) ??
        (typeof result === "string" ? result : null);

      await supabaseAdmin.from("omada_voucher_batches").insert({
        ecosystem_id: data.ecosystemId,
        group_id: groupId ?? null,
        group_name: String(data.payload["name"] ?? "Voucher group"),
        amount: Number(data.payload["amount"] ?? 0),
        request: data.payload as never,
        response: result as never,
        created_by: (context as unknown as AuthContext).userId,
      });

      return { ok: true as const, groupId: groupId ?? null };
    } catch (e) {
      return friendly(e);
    }
  });

/** Admin: what this shop has generated through WaveWallet. */
export const listOmadaVoucherBatches = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { ecosystemId: string }) => {
    if (!data?.ecosystemId) throw new Error("A shop is required.");
    return data;
  })
  .handler(async ({ data, context }) => {
    await assertShopAdmin(context as unknown as AuthContext, data.ecosystemId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("omada_voucher_batches")
      .select("id, group_id, group_name, amount, created_at")
      .eq("ecosystem_id", data.ecosystemId)
      .order("created_at", { ascending: false })
      .limit(25);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export interface OmadaVoucherStatus {
  configured: boolean;
  /** Translated, customer-safe view. Raw controller fields never cross over. */
  view: VoucherView | null;
  searched: boolean;
  outcome:
    | "ready"
    | "found"
    | "not_found"
    | "invalid"
    | "unavailable"
    | "authentication_failed"
    | "status_unreadable";
  error: string | null;
}

const EMPTY_STATUS: OmadaVoucherStatus = {
  configured: false,
  view: null,
  searched: false,
  outcome: "ready",
  error: null,
};

function normaliseCode(raw: string | undefined) {
  const code = (raw ?? "").trim();
  const invalid = Boolean(code) && !/^[A-Za-z0-9-]{4,64}$/.test(code);
  return { code, invalid };
}

/**
 * Shared, tenant-scoped voucher lookup.
 *
 * Omada stays authoritative: the voucher row gives status/usage/timestamps, its
 * group gives the price, and the site's authorized clients give every device
 * (MAC) currently authorized by that code. A code that no group contains is a
 * genuine "not found"; a controller problem is reported as such instead.
 */
async function statusFor(ecosystemId: string, rawCode: string | undefined) {
  const { code, invalid } = normaliseCode(rawCode);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { openOmadaSession } = await import("./omada-api.server");
  const {
    loadOmadaSpec,
    voucherCapabilities,
    listAllVoucherGroups,
    findVoucherByCode,
    listAuthorizedClients,
  } = await import("./omada-vouchers.server");

  if (invalid) {
    return {
      ...EMPTY_STATUS,
      configured: true,
      searched: true,
      outcome: "invalid" as const,
      error: "Enter a valid voucher code.",
    };
  }

  try {
    const session = await openOmadaSession(supabaseAdmin as never, ecosystemId);
    const caps = voucherCapabilities(await loadOmadaSpec(session));
    const groups = await listAllVoucherGroups(session, caps);
    if (!code) return { ...EMPTY_STATUS, configured: true };

    for (const group of groups) {
      const groupId = String(group["id"] ?? group["groupId"] ?? "");
      if (!groupId) continue;
      const hit = await findVoucherByCode(session, caps, groupId, code);
      if (!hit) continue;

      const clients = await listAuthorizedClients(session).catch(() => []);
      const view = toVoucherView(code, hit, group, clients);
      if (!view) {
        return {
          ...EMPTY_STATUS,
          configured: true,
          searched: true,
          outcome: "status_unreadable" as const,
          error:
            "The controller returned this voucher without a status it could read. Try again shortly.",
        };
      }
      return {
        ...EMPTY_STATUS,
        configured: true,
        searched: true,
        outcome: "found" as const,
        view,
      };
    }
    return { ...EMPTY_STATUS, configured: true, searched: true, outcome: "not_found" as const };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes("no Omada controller connected")) return EMPTY_STATUS;
    const authenticationFailed = /authentication|unauthorized|HTTP 401|HTTP 403/i.test(message);
    return {
      ...EMPTY_STATUS,
      configured: true,
      searched: Boolean(code),
      outcome: authenticationFailed ? ("authentication_failed" as const) : ("unavailable" as const),
      error: authenticationFailed
        ? "The hotspot controller rejected this shop's connection. Ask the shop admin to reconnect it."
        : "The hotspot controller could not be reached right now, so the voucher status is unavailable. Please try again shortly.",
    };
  }
}

/**
 * Any member of this shop: read-only voucher status from its own controller.
 *
 * The lookup is shop-scoped by construction — the code is only ever searched on
 * the controller belonging to `ecosystemId`, and only members of that shop may
 * call it. There is no global or cross-shop voucher search.
 */
export const lookupOmadaVoucher = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { ecosystemId: string; code?: string | undefined }) => {
    if (!data?.ecosystemId) throw new Error("A shop is required.");
    return data;
  })
  .handler(async ({ data, context }): Promise<OmadaVoucherStatus> => {
    await assertShopMember(context as unknown as AuthContext, data.ecosystemId);
    return statusFor(data.ecosystemId, data.code);
  });


/* ------------------------------------------------------------------ *
 * Shop-specific voucher generation workflow.
 *
 * Every call re-derives the shop from `ecosystemId` and re-authorises the
 * caller as that shop's admin (or the platform owner). Products, calibrations,
 * controller sessions, generated groups and imported codes are all filtered by
 * that same shop id server-side — the browser can never widen the scope.
 * ------------------------------------------------------------------ */

import {
  VERIFIED_VOUCHER_FIELDS,
  controllerMismatch,
  defaultGenerationValues,
  defaultGroupName,
  reviewExtractedCodes,
  validateGenerationPayload,
  type ControllerIdentity,
  type GenValue,
  type VoucherFieldSpec,
} from "./omada-generation";

export interface GenerationProduct {
  id: string;
  name: string;
  credit_price: number;
  points_price: number | null;
  promo_price: number | null;
}

export interface GenerationCalibration {
  id: string;
  version: number;
  payload: Record<string, GenValue>;
  controller_identity: Partial<ControllerIdentity>;
  created_at: string;
}

export interface VoucherGenerationSetup {
  configured: boolean;
  error: string | null;
  controller: ControllerIdentity | null;
  fields: VoucherFieldSpec[];
  defaults: Record<string, GenValue>;
  products: GenerationProduct[];
  /** Current calibration per product id, when one has been saved. */
  calibrations: Record<string, GenerationCalibration>;
  /** Existing group names on the controller, used for safe default naming. */
  groupNames: string[];
}

/** Admin: everything needed to prepare a generation for one shop. */
export const getVoucherGenerationSetup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { ecosystemId: string }) => {
    if (!data?.ecosystemId) throw new Error("A shop is required.");
    return data;
  })
  .handler(async ({ data, context }): Promise<VoucherGenerationSetup> => {
    await assertShopAdmin(context as unknown as AuthContext, data.ecosystemId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { openOmadaSession } = await import("./omada-api.server");
    const { readControllerInfo, listAllVoucherGroups, voucherCapabilities, VERIFIED_CREATE_PATH } =
      await import("./omada-vouchers.server");

    const products = (
      await supabaseAdmin
        .from("voucher_products")
        .select("id, name, credit_price, points_price, promo_price")
        .eq("ecosystem_id", data.ecosystemId)
        .eq("archived", false)
        .order("name")
    ).data as GenerationProduct[] | null;

    const calibrationRows = (
      await supabaseAdmin
        .from("omada_voucher_calibrations")
        .select("id, product_id, version, payload, controller_identity, created_at")
        .eq("ecosystem_id", data.ecosystemId)
        .eq("is_current", true)
    ).data as Array<GenerationCalibration & { product_id: string }> | null;

    const calibrations: Record<string, GenerationCalibration> = {};
    for (const row of calibrationRows ?? []) {
      calibrations[row.product_id] = {
        id: row.id,
        version: row.version,
        payload: (row.payload ?? {}) as Record<string, GenValue>,
        controller_identity: (row.controller_identity ?? {}) as Partial<ControllerIdentity>,
        created_at: row.created_at,
      };
    }

    const base: VoucherGenerationSetup = {
      configured: false,
      error: null,
      controller: null,
      fields: VERIFIED_VOUCHER_FIELDS,
      defaults: defaultGenerationValues(),
      products: products ?? [],
      calibrations,
      groupNames: [],
    };

    try {
      const session = await openOmadaSession(supabaseAdmin as never, data.ecosystemId);
      const info = await readControllerInfo(session);
      let groupNames: string[] = [];
      try {
        const caps = voucherCapabilities(null);
        const groups = await listAllVoucherGroups(session, {
          ...caps,
          listPath: caps.listPath ?? VERIFIED_CREATE_PATH,
        });
        groupNames = groups.map((g) => String(g["name"] ?? "")).filter(Boolean);
      } catch {
        /* naming help is best-effort */
      }
      return {
        ...base,
        configured: true,
        controller: {
          baseUrl: session.base,
          omadacId: session.omadacId,
          siteId: session.siteId,
          controllerVersion: info.controllerVersion,
        },
        groupNames,
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (message.includes("no Omada controller connected")) return base;
      return { ...base, configured: true, error: message };
    }
  });

/** Group name suggestion, kept unique for the same product on the same day. */
export function suggestGroupName(productName: string, existingNames: string[]): string {
  return defaultGroupName(productName, existingNames);
}

export interface GenerationOutcome {
  batchId: string;
  groupId: string | null;
  groupName: string;
  calibrationVersion: number | null;
  extracted: string[];
  duplicateInInventory: string[];
  retrievalNote: string | null;
}

/**
 * Admin: send the reviewed request to this shop's own controller, then read the
 * generated group back and extract ONLY the voucher codes. Nothing is imported
 * into inventory here — the admin must confirm the preview separately.
 */
export const generateVoucherGroupForProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      ecosystemId: string;
      productId: string;
      payload: Record<string, GenValue>;
      saveAsCalibration?: boolean;
    }) => {
      if (!data?.ecosystemId) throw new Error("A shop is required.");
      if (!data?.productId) throw new Error("Choose a voucher product first.");
      if (!data.payload || typeof data.payload !== "object") throw new Error("Nothing to send.");
      return data;
    },
  )
  .handler(async ({ data, context }): Promise<GenerationOutcome> => {
    const ctx = context as unknown as AuthContext;
    await assertShopAdmin(ctx, data.ecosystemId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { openOmadaSession } = await import("./omada-api.server");
    const {
      readControllerInfo,
      createVoucherGroupVerified,
      findGroupIdByName,
      fetchGroupCodes,
      voucherCapabilities,
      VERIFIED_CREATE_PATH,
    } = await import("./omada-vouchers.server");

    // The product must belong to THIS shop; ids from the browser are never trusted.
    const product = (
      await supabaseAdmin
        .from("voucher_products")
        .select("id, name")
        .eq("id", data.productId)
        .eq("ecosystem_id", data.ecosystemId)
        .maybeSingle()
    ).data as { id: string; name: string } | null;
    if (!product) throw new Error("That voucher product does not belong to this shop.");

    const payload = { ...data.payload };
    const groupName = String(payload["name"] ?? "").trim();
    if (!groupName) throw new Error("A group name is required.");

    const problems = validateGenerationPayload(payload);
    if (problems.length > 0) throw new Error(problems.join(" "));

    try {
      const session = await openOmadaSession(supabaseAdmin as never, data.ecosystemId);
      const info = await readControllerInfo(session);
      const identity = {
        baseUrl: session.base,
        omadacId: session.omadacId,
        siteId: session.siteId,
        controllerVersion: info.controllerVersion,
      };

      const startedAt = Date.now();
      const created = await createVoucherGroupVerified(session, payload);

      let groupId = created.groupId;
      let retrievalNote: string | null = null;
      if (!groupId) {
        const caps = voucherCapabilities(null);
        groupId = await findGroupIdByName(
          session,
          { ...caps, listPath: caps.listPath ?? VERIFIED_CREATE_PATH },
          groupName,
          startedAt,
        );
        retrievalNote = groupId
          ? "The controller did not return a group id, so the new group was matched by name and creation time."
          : "The vouchers were created, but the controller did not return the new group. Open the Omada group and import its codes manually.";
      }

      let extracted: string[] = [];
      if (groupId) {
        const read = await fetchGroupCodes(session, groupId);
        extracted = read.codes;
      }

      // Duplicate check against this shop's existing inventory only.
      const inventory = (
        await supabaseAdmin
          .from("voucher_codes")
          .select("code")
          .eq("ecosystem_id", data.ecosystemId)
      ).data as Array<{ code: string }> | null;
      const existing = new Set((inventory ?? []).map((r) => r.code.trim().toUpperCase()));
      const duplicateInInventory = extracted.filter((c) => existing.has(c.trim().toUpperCase()));

      let calibrationVersion: number | null = null;
      let calibrationId: string | null = null;
      if (data.saveAsCalibration) {
        const saved = await saveCalibrationRow(
          supabaseAdmin,
          data.ecosystemId,
          data.productId,
          payload,
          identity,
          ctx.userId,
        );
        calibrationVersion = saved.version;
        calibrationId = saved.id;
      } else {
        const current = (
          await supabaseAdmin
            .from("omada_voucher_calibrations")
            .select("id, version")
            .eq("ecosystem_id", data.ecosystemId)
            .eq("product_id", data.productId)
            .eq("is_current", true)
            .maybeSingle()
        ).data as { id: string; version: number } | null;
        calibrationVersion = current?.version ?? null;
        calibrationId = current?.id ?? null;
      }

      const batch = (
        await supabaseAdmin
          .from("omada_voucher_batches")
          .insert({
            ecosystem_id: data.ecosystemId,
            product_id: data.productId,
            calibration_id: calibrationId,
            calibration_version: calibrationVersion,
            controller_identity: identity as never,
            group_id: groupId,
            group_name: groupName,
            amount: Number(payload["amount"] ?? 0),
            extracted_count: extracted.length,
            request: payload as never,
            response: (created.result ?? {}) as never,
            created_by: ctx.userId,
          })
          .select("id")
          .single()
      ).data as { id: string } | null;

      return {
        batchId: batch?.id ?? "",
        groupId,
        groupName,
        calibrationVersion,
        extracted,
        duplicateInInventory,
        retrievalNote,
      };
    } catch (e) {
      return friendly(e);
    }
  });

async function saveCalibrationRow(
  supabaseAdmin: {
    from: (table: string) => {
      select: (columns: string) => any;
      update: (values: Record<string, unknown>) => any;
      insert: (values: Record<string, unknown>) => any;
    };
  },
  ecosystemId: string,
  productId: string,
  payload: Record<string, GenValue>,
  identity: ControllerIdentity,
  userId: string,
): Promise<{ id: string; version: number }> {
  const latest = (
    await supabaseAdmin
      .from("omada_voucher_calibrations")
      .select("version")
      .eq("ecosystem_id", ecosystemId)
      .eq("product_id", productId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle()
  ).data as { version: number } | null;
  const version = (latest?.version ?? 0) + 1;

  await supabaseAdmin
    .from("omada_voucher_calibrations")
    .update({ is_current: false })
    .eq("ecosystem_id", ecosystemId)
    .eq("product_id", productId);

  const inserted = (
    await supabaseAdmin
      .from("omada_voucher_calibrations")
      .insert({
        ecosystem_id: ecosystemId,
        product_id: productId,
        version,
        payload: payload as never,
        controller_identity: identity as never,
        is_current: true,
        created_by: userId,
      })
      .select("id, version")
      .single()
  ).data as { id: string; version: number } | null;
  if (!inserted) throw new Error("The calibration could not be saved.");
  return inserted;
}

/** Admin: explicitly save the settings just used as this product's calibration. */
export const saveVoucherCalibration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: { ecosystemId: string; productId: string; payload: Record<string, GenValue> }) => {
      if (!data?.ecosystemId || !data?.productId) throw new Error("A shop and product are required.");
      if (!data.payload || typeof data.payload !== "object") throw new Error("Nothing to save.");
      return data;
    },
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as AuthContext;
    await assertShopAdmin(ctx, data.ecosystemId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { openOmadaSession } = await import("./omada-api.server");
    const { readControllerInfo } = await import("./omada-vouchers.server");
    const product = (
      await supabaseAdmin
        .from("voucher_products")
        .select("id")
        .eq("id", data.productId)
        .eq("ecosystem_id", data.ecosystemId)
        .maybeSingle()
    ).data as { id: string } | null;
    if (!product) throw new Error("That voucher product does not belong to this shop.");

    const session = await openOmadaSession(supabaseAdmin as never, data.ecosystemId);
    const info = await readControllerInfo(session);
    const saved = await saveCalibrationRow(
      supabaseAdmin as never,
      data.ecosystemId,
      data.productId,
      data.payload,
      {
        baseUrl: session.base,
        omadacId: session.omadacId,
        siteId: session.siteId,
        controllerVersion: info.controllerVersion,
      },
      ctx.userId,
    );
    return { ok: true as const, version: saved.version };
  });

export interface ImportOutcome {
  importedCount: number;
  duplicateCount: number;
  invalidCount: number;
  importId: string | null;
}

/**
 * Admin: import the codes the admin confirmed in the preview into THIS shop's
 * inventory. Duplicates are skipped, never overwritten, and the resulting
 * import is linked back to the generation batch for full lineage.
 */
export const importGeneratedVoucherCodes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: { ecosystemId: string; productId: string; batchId?: string; codes: string[] }) => {
      if (!data?.ecosystemId || !data?.productId) throw new Error("A shop and product are required.");
      if (!Array.isArray(data.codes) || data.codes.length === 0)
        throw new Error("Select at least one code to import.");
      return data;
    },
  )
  .handler(async ({ data, context }): Promise<ImportOutcome> => {
    const ctx = context as unknown as AuthContext;
    await assertShopAdmin(ctx, data.ecosystemId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const product = (
      await supabaseAdmin
        .from("voucher_products")
        .select("id")
        .eq("id", data.productId)
        .eq("ecosystem_id", data.ecosystemId)
        .maybeSingle()
    ).data as { id: string } | null;
    if (!product) throw new Error("That voucher product does not belong to this shop.");

    const inventory = (
      await supabaseAdmin.from("voucher_codes").select("code").eq("ecosystem_id", data.ecosystemId)
    ).data as Array<{ code: string }> | null;
    const review = reviewExtractedCodes(
      data.codes,
      (inventory ?? []).map((r) => r.code),
    );
    if (review.importable.length === 0) {
      return {
        importedCount: 0,
        duplicateCount: review.duplicateInBatch + review.duplicateInInventory,
        invalidCount: review.invalid,
        importId: null,
      };
    }

    // Runs as the signed-in admin, so the existing inventory rules and audit
    // trail apply exactly as they do for a manual import.
    const { data: rows, error } = await (
      ctx.supabase as unknown as {
        rpc: (fn: string, args: unknown) => Promise<{ data: unknown; error: { message: string } | null }>;
      }
    ).rpc("import_voucher_codes", {
      _product_id: data.productId,
      _codes: review.importable,
      _source: "omada",
    });
    if (error) throw new Error(error.message);
    const result = (rows as Array<{
      batch_id: string;
      imported_count: number;
      duplicate_count: number;
      invalid_count: number;
    }> | null)?.[0];

    if (data.batchId && result?.batch_id) {
      await supabaseAdmin
        .from("omada_voucher_batches")
        .update({ import_id: result.batch_id, imported_count: result.imported_count })
        .eq("id", data.batchId)
        .eq("ecosystem_id", data.ecosystemId);
    }

    return {
      importedCount: result?.imported_count ?? 0,
      duplicateCount: (result?.duplicate_count ?? 0) + review.duplicateInInventory,
      invalidCount: (result?.invalid_count ?? 0) + review.invalid,
      importId: result?.batch_id ?? null,
    };
  });

export { controllerMismatch };

/**
 * Admin: which of these codes already exist in THIS shop's Code Inventory.
 *
 * Used by the editable preview so an admin sees exactly which codes are
 * existing duplicates before importing. Inventory uniqueness is shop-scoped:
 * the same code in another shop is irrelevant here. This is a convenience
 * check only — the import path re-checks and the database's per-shop unique
 * index is the final, race-safe guard.
 */
export const checkExistingVoucherCodes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { ecosystemId: string; codes: string[] }) => {
    if (!data?.ecosystemId) throw new Error("A shop is required.");
    if (!Array.isArray(data.codes)) throw new Error("Codes are required.");
    return data;
  })
  .handler(async ({ data, context }): Promise<{ existing: string[] }> => {
    const ctx = context as unknown as AuthContext;
    await assertShopAdmin(ctx, data.ecosystemId);
    const wanted = new Set(data.codes.map((c) => c.trim().toUpperCase()).filter(Boolean));
    if (wanted.size === 0) return { existing: [] };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const rows = (
      await supabaseAdmin.from("voucher_codes").select("code").eq("ecosystem_id", data.ecosystemId)
    ).data as Array<{ code: string }> | null;
    const existing = (rows ?? [])
      .map((r) => r.code.trim().toUpperCase())
      .filter((c) => wanted.has(c));
    return { existing: Array.from(new Set(existing)) };
  });
