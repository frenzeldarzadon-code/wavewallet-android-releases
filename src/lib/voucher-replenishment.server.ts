/**
 * Server side of automatic Voucher Shop stock replenishment.
 *
 * One shop, one voucher product, one calibration: the top-up reuses the exact
 * generation path an admin uses by hand (this shop's own Omada controller, the
 * product's own saved calibration) and imports the resulting codes into the
 * same shop's voucher stock. A product with no saved calibration is never
 * generated for, and a unique index on the runs table makes concurrent
 * triggers impossible to duplicate.
 */
import {
  availableStock,
  replenishmentPayload,
  REPLENISH_BATCH_SIZE,
  type ReplenishSkipReason,
} from "./voucher-replenishment";
import { defaultGroupName, validateGenerationPayload, type GenValue } from "./omada-generation";

/** Minimal shape of the service-role client this job needs. */
export interface AdminClient {
  from: (table: string) => any;
  rpc: (fn: string, args: unknown) => Promise<{ data: unknown; error: { message: string } | null }>;
}

export interface GenerationResult {
  codes: string[];
  groupId: string | null;
  groupName: string;
  identity: Record<string, unknown>;
  response: unknown;
}

export interface ReplenishDeps {
  /** Creates the group on the shop's own controller and reads its codes back. */
  generate: (input: {
    ecosystemId: string;
    payload: Record<string, GenValue>;
    groupName: string;
    existingGroupId?: string | null;
  }) => Promise<GenerationResult>;
  now?: () => number;
}

export interface ReplenishResult {
  ecosystemId: string;
  productId: string;
  status: "completed" | "failed" | "skipped";
  reason: ReplenishSkipReason | "low_stock";
  available: number;
  requested: number;
  imported: number;
  runId: string | null;
  error: string | null;
}

async function realGenerate(input: {
  ecosystemId: string;
  payload: Record<string, GenValue>;
  groupName: string;
  existingGroupId?: string | null;
}): Promise<GenerationResult> {
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

  const session = await openOmadaSession(supabaseAdmin as never, input.ecosystemId);
  const info = await readControllerInfo(session);
  if (input.existingGroupId) {
    const recovered = await fetchGroupCodes(session, input.existingGroupId);
    return {
      codes: recovered.codes,
      groupId: input.existingGroupId,
      groupName: recovered.groupName ?? input.groupName,
      identity: {
        baseUrl: session.base,
        omadacId: session.omadacId,
        siteId: session.siteId,
        controllerVersion: info.controllerVersion,
      },
      response: { recovered: true },
    };
  }
  const startedAt = Date.now();
  const created = await createVoucherGroupVerified(session, input.payload);
  const groupName = created.name;
  let groupId = created.groupId;
  if (!groupId) {
    const caps = voucherCapabilities(null);
    groupId = await findGroupIdByName(
      session,
      { ...caps, listPath: caps.listPath ?? VERIFIED_CREATE_PATH },
      groupName,
      startedAt,
    );
  }
  const codes = groupId ? (await fetchGroupCodes(session, groupId)).codes : [];
  return {
    codes,
    groupId,
    groupName,
    identity: {
      baseUrl: session.base,
      omadacId: session.omadacId,
      siteId: session.siteId,
      controllerVersion: info.controllerVersion,
    },
    response: created.result ?? {},
  };
}

/** Available (unused, uncommitted) Voucher Shop codes for one exact product. */
export async function availableStockFor(
  admin: AdminClient,
  ecosystemId: string,
  productId: string,
): Promise<number> {
  const rows = (
    await admin
      .from("voucher_codes")
      .select("status, sold_to, sale_id")
      .eq("ecosystem_id", ecosystemId)
      .eq("product_id", productId)
  ).data as Array<{ status: string; sold_to: string | null; sale_id: string | null }> | null;
  return availableStock(rows ?? []);
}

function skip(
  ecosystemId: string,
  productId: string,
  reason: ReplenishSkipReason,
  available: number,
): ReplenishResult {
  return {
    ecosystemId,
    productId,
    status: "skipped",
    reason,
    available,
    requested: 0,
    imported: 0,
    runId: null,
    error: null,
  };
}

/**
 * Check one product and, when it qualifies, run exactly one replenishment.
 * Safe to call from anywhere: it is idempotent under concurrency.
 */
export async function replenishProduct(
  admin: AdminClient,
  input: { ecosystemId: string; productId: string; trigger?: string },
  deps: ReplenishDeps = { generate: realGenerate },
): Promise<ReplenishResult> {
  const { ecosystemId, productId } = input;
  const now = deps.now ?? Date.now;

  // A deleted (or archived) product can never generate again. This is checked
  // here, on the server, so an in-flight or queued job that was started before
  // the deletion simply stops instead of creating codes for a dead product.
  const product = (
    await admin
      .from("voucher_products")
      .select("id, name, archived")
      .eq("id", productId)
      .eq("ecosystem_id", ecosystemId)
      .maybeSingle()
  ).data as { id: string; name: string; archived: boolean } | null;
  if (!product || product.archived) {
    return skip(ecosystemId, productId, "product_deleted", 0);
  }

  // Calibration is per shop + per product. There is never a fallback to
  // another product's or another shop's calibration.
  const calibration = (
    await admin
      .from("omada_voucher_calibrations")
      .select("id, version, payload")
      .eq("ecosystem_id", ecosystemId)
      .eq("product_id", productId)
      .eq("is_current", true)
      .maybeSingle()
  ).data as { id: string; version: number; payload: Record<string, GenValue> } | null;

  const available = await availableStockFor(admin, ecosystemId, productId);
  if (!calibration) return skip(ecosystemId, productId, "no_calibration", available);

  const existingNames = ((
    await admin
      .from("omada_voucher_batches")
      .select("group_name")
      .eq("ecosystem_id", ecosystemId)
  ).data as Array<{ group_name: string }> | null) ?? [];
  const proposedGroupName = defaultGroupName(product.name, existingNames.map((r) => r.group_name));
  const claimed = await admin.rpc("claim_voucher_replenishment_event", {
    _ecosystem_id: ecosystemId,
    _product_id: productId,
    _calibration_id: calibration.id,
    _calibration_version: calibration.version,
    _available: available,
    _trigger_source: input.trigger ?? "sweep",
    _group_name: proposedGroupName,
    _now: new Date(now()).toISOString(),
  });
  if (claimed.error) throw new Error(claimed.error.message);
  const claim = (claimed.data as Array<{
    claimed: boolean; reason: ReplenishSkipReason | "claimed"; run_id: string | null; group_name: string | null;
  }> | null)?.[0];
  if (!claim?.claimed || !claim.run_id) {
    const reason = claim?.reason === "claimed" ? "in_progress" : (claim?.reason ?? "in_progress");
    return skip(ecosystemId, productId, reason, available);
  }
  const runId = claim.run_id;
  const eventState = (
    await admin
      .from("voucher_replenishment_states")
      .select("group_id, group_name")
      .eq("ecosystem_id", ecosystemId)
      .eq("product_id", productId)
      .maybeSingle()
  ).data as { group_id: string | null; group_name: string | null } | null;
  const groupName = claim.group_name ?? eventState?.group_name ?? proposedGroupName;
  let generated: GenerationResult | null = null;
  let batchId: string | null = null;
  let imported = 0;

  try {
    const payload = replenishmentPayload(
      calibration.payload,
      groupName,
      REPLENISH_BATCH_SIZE,
    );
    const problems = validateGenerationPayload(payload);
    if (problems.length > 0) throw new Error(problems.join(" "));

    generated = await deps.generate({
      ecosystemId,
      payload,
      groupName,
      existingGroupId: eventState?.group_id ?? null,
    });

    const batch = (
      await admin
        .from("omada_voucher_batches")
        .insert({
          ecosystem_id: ecosystemId,
          product_id: productId,
          calibration_id: calibration?.id ?? null,
          calibration_version: calibration?.version ?? null,
          controller_identity: generated.identity,
          group_id: generated.groupId,
          group_name: generated.groupName,
          amount: Number(payload["amount"] ?? 0),
          extracted_count: generated.codes.length,
          request: payload,
          response: generated.response ?? {},
        })
        .select("id")
        .single()
    ).data as { id: string } | null;

    let importBatchId: string | null = null;
    if (generated.codes.length > 0) {
      const { data, error } = await admin.rpc("system_import_voucher_codes", {
        _ecosystem_id: ecosystemId,
        _product_id: productId,
        _codes: generated.codes,
        _source: "omada-auto",
      });
      if (error) throw new Error(error.message);
      const row = (data as Array<{ batch_id: string; imported_count: number }> | null)?.[0];
      imported = row?.imported_count ?? 0;
      importBatchId = row?.batch_id ?? null;
    }

    if (generated.codes.length !== REPLENISH_BATCH_SIZE) {
      throw new Error(`Omada returned ${generated.codes.length} of ${REPLENISH_BATCH_SIZE} expected vouchers; event paused for safe recovery.`);
    }

    if (batch?.id && importBatchId) {
      await admin
        .from("omada_voucher_batches")
        .update({ import_id: importBatchId, imported_count: imported })
        .eq("id", batch.id);
    }

    batchId = batch?.id ?? null;
    const after = await availableStockFor(admin, ecosystemId, productId);
    const finished = await admin.rpc("finish_voucher_replenishment_event", {
      _ecosystem_id: ecosystemId, _product_id: productId, _run_id: runId,
      _success: true, _group_id: generated.groupId, _group_name: generated.groupName,
      _generated: generated.codes.length, _imported: imported, _available_after: after,
      _batch_id: batchId, _error: null, _now: new Date(now()).toISOString(),
    });
    if (finished.error) throw new Error(finished.error.message);

    return {
      ecosystemId,
      productId,
      status: "completed",
      reason: "low_stock",
      available,
      requested: REPLENISH_BATCH_SIZE,
      imported,
      runId,
      error: null,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await admin.rpc("finish_voucher_replenishment_event", {
      _ecosystem_id: ecosystemId, _product_id: productId, _run_id: runId,
      _success: false, _group_id: generated?.groupId ?? eventState?.group_id ?? null,
      _group_name: generated?.groupName ?? groupName,
      _generated: generated?.codes.length ?? 0, _imported: imported,
      _available_after: await availableStockFor(admin, ecosystemId, productId),
      _batch_id: batchId, _error: message, _now: new Date(now()).toISOString(),
    });
    return {
      ecosystemId,
      productId,
      status: "failed",
      reason: "low_stock",
      available,
      requested: REPLENISH_BATCH_SIZE,
      imported: 0,
      runId,
      error: message,
    };
  }
}

/** Check every calibrated product of one shop. */
export async function replenishShop(
  admin: AdminClient,
  ecosystemId: string,
  deps?: ReplenishDeps,
): Promise<ReplenishResult[]> {
  const calibrated = (
    await admin
      .from("omada_voucher_calibrations")
      .select("product_id")
      .eq("ecosystem_id", ecosystemId)
      .eq("is_current", true)
  ).data as Array<{ product_id: string }> | null;
  const results: ReplenishResult[] = [];
  for (const row of calibrated ?? []) {
    try {
      results.push(
        await replenishProduct(
          admin,
          { ecosystemId, productId: row.product_id, trigger: "sweep" },
          deps,
        ),
      );
    } catch {
      /* one product never stops the sweep */
    }
    // Stamped whether or not anything was generated, so the Generate screen can
    // honestly show when the background check last looked at this product.
    try {
      await admin
        .from("omada_voucher_calibrations")
        .update({ last_auto_check_at: new Date((deps?.now ?? Date.now)()).toISOString() })
        .eq("ecosystem_id", ecosystemId)
        .eq("product_id", row.product_id)
        .eq("is_current", true);
    } catch {
      /* stamping is informational only */
    }
  }
  return results;
}

/** Scheduled sweep across every shop that has at least one calibration. */
export async function sweepReplenishments(
  admin: AdminClient,
  deps?: ReplenishDeps,
): Promise<{ shops: number; checked: number; replenished: number; failed: number }> {
  const rows = (
    await admin.from("omada_voucher_calibrations").select("ecosystem_id").eq("is_current", true)
  ).data as Array<{ ecosystem_id: string }> | null;
  const shops = Array.from(new Set((rows ?? []).map((r) => r.ecosystem_id)));
  let checked = 0;
  let replenished = 0;
  let failed = 0;
  for (const ecosystemId of shops) {
    const results = await replenishShop(admin, ecosystemId, deps);
    checked += results.length;
    replenished += results.filter((r) => r.status === "completed").length;
    failed += results.filter((r) => r.status === "failed").length;
  }
  return { shops: shops.length, checked, replenished, failed };
}
