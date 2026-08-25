/**
 * Omada voucher operations, always scoped to ONE shop.
 *
 * Generation is admin-only; voucher status lookup is open to any member of that
 * same shop. No credential, token or controller address ever leaves the server.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { OmadaFieldSpec } from "./omada-vouchers.server";

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
  groups: Array<{ id: string; name: string }>;
  found: OmadaRow | null;
  searched: boolean;
  error: string | null;
}

/** Any member of this shop: read-only voucher status from its own controller. */
export const lookupOmadaVoucher = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { ecosystemId: string; code?: string }) => {
    if (!data?.ecosystemId) throw new Error("A shop is required.");
    return { ecosystemId: data.ecosystemId, code: (data.code ?? "").trim() };
  })
  .handler(async ({ data, context }): Promise<OmadaVoucherStatus> => {
    await assertShopMember(context as unknown as AuthContext, data.ecosystemId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { openOmadaSession } = await import("./omada-api.server");
    const { loadOmadaSpec, voucherCapabilities, listVoucherGroups, listVouchersInGroup } =
      await import("./omada-vouchers.server");

    const empty: OmadaVoucherStatus = {
      configured: false,
      groups: [],
      found: null,
      searched: false,
      error: null,
    };
    try {
      const session = await openOmadaSession(supabaseAdmin as never, data.ecosystemId);
      const caps = voucherCapabilities(await loadOmadaSpec(session));
      const groups = await listVoucherGroups(session, caps);
      const list = groups.map((g) => ({
        id: String(g["id"] ?? g["groupId"] ?? ""),
        name: String(g["name"] ?? "Voucher group"),
      }));
      if (!data.code) return { ...empty, configured: true, groups: list };

      const wanted = data.code.toUpperCase();
      for (const group of list) {
        if (!group.id) continue;
        const { rows } = await listVouchersInGroup(session, caps, group.id);
        const hit = rows.find((r) => String(r["code"] ?? "").toUpperCase() === wanted);
        if (hit) {
          return {
            ...empty,
            configured: true,
            groups: list,
            searched: true,
            found: { ...flatten(hit), groupName: group.name },
          };
        }
      }
      return { ...empty, configured: true, groups: list, searched: true };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (message.includes("no Omada controller connected")) return empty;
      return { ...empty, configured: true, error: message };
    }
  });
