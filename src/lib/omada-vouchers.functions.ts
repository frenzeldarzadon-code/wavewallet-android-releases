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

/** Any member of this shop: read-only voucher status from its own controller. */
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

/**
 * Public Status Checker: anyone holding a voucher code may check it and label
 * the devices using it. No account, membership or role is required — the code
 * itself is the only thing being looked up, one code at a time, and nothing
 * about the shop's operations or controller is exposed.
 */
export const lookupVoucherPublicly = createServerFn({ method: "POST" })
  .inputValidator((data: { shopSlug: string; code?: string | undefined }) => {
    if (!data?.shopSlug) throw new Error("A shop is required.");
    return data;
  })
  .handler(async ({ data }): Promise<OmadaVoucherStatus & { ecosystemId: string | null }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: shop } = await supabaseAdmin
      .from("ecosystems")
      .select("id")
      .eq("slug", data.shopSlug)
      .maybeSingle();
    if (!shop) return { ...EMPTY_STATUS, ecosystemId: null };
    const status = await statusFor(shop.id as string, data.code);
    return { ...status, ecosystemId: shop.id as string };
  });

/** Public: shops whose hotspot controller is connected, for the public checker. */
export const listVoucherStatusShops = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("omada_connections")
    .select("ecosystem_id, ecosystems!inner(name, slug)");
  return (data ?? [])
    .map((row) => {
      const shop = (row as { ecosystems: { name: string; slug: string } | null }).ecosystems;
      return shop ? { name: shop.name, slug: shop.slug } : null;
    })
    .filter((row): row is { name: string; slug: string } => Boolean(row?.slug))
    .sort((a, b) => a.name.localeCompare(b.name));
});

