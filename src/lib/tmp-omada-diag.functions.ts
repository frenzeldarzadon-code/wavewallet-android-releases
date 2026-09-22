/** TEMPORARY diagnostic: lists the controller's voucher-related API paths. Deleted after the cleanup audit. */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const tmpOmadaVoucherPaths = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { ecosystemId: string }) => {
    if (!data?.ecosystemId) throw new Error("A shop is required.");
    return data;
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as {
      supabase: { rpc: (fn: string, args: unknown) => Promise<{ data: unknown; error: { message: string } | null }> };
      userId: string;
    };
    const admin = await ctx.supabase.rpc("is_ecosystem_admin", {
      _user_id: ctx.userId,
      _ecosystem_id: data.ecosystemId,
    });
    if (admin.data !== true) throw new Error("Not authorised.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { openOmadaSession } = await import("./omada-api.server");
    const { loadOmadaSpec, voucherCapabilities } = await import("./omada-vouchers.server");
    const session = await openOmadaSession(supabaseAdmin as never, data.ecosystemId);
    const spec = await loadOmadaSpec(session);
    const paths = ((spec?.["paths"] as Record<string, Record<string, unknown>>) ?? {});
    const voucherPaths = Object.entries(paths)
      .filter(([p]) => /voucher/i.test(p))
      .map(([p, ops]) => `${p} :: ${Object.keys(ops).join(",")}`);
    return { specFound: Boolean(spec), voucherPaths, caps: voucherCapabilities(spec) };
  });

export const tmpOmadaGroupStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { ecosystemId: string; groupIds: string[] }) => data)
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as {
      supabase: { rpc: (fn: string, args: unknown) => Promise<{ data: unknown; error: unknown }> };
      userId: string;
    };
    const admin = await ctx.supabase.rpc("is_ecosystem_admin", {
      _user_id: ctx.userId,
      _ecosystem_id: data.ecosystemId,
    });
    if (admin.data !== true) throw new Error("Not authorised.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { openOmadaSession } = await import("./omada-api.server");
    const { fetchGroupRows } = await import("./omada-vouchers.server");
    const session = await openOmadaSession(supabaseAdmin as never, data.ecosystemId);
    const out: Record<string, unknown> = {};
    for (const gid of data.groupIds) {
      try {
        const rows = await fetchGroupRows(session, gid);
        const counts: Record<string, number> = {};
        for (const r of rows.rows) {
          const k = String((r as Record<string, unknown>)["status"] ?? "?");
          counts[k] = (counts[k] ?? 0) + 1;
        }
        out[gid] = { total: rows.total, fetched: rows.rows.length, statusCounts: counts, name: rows.groupName };
      } catch (e) {
        out[gid] = { error: e instanceof Error ? e.message : String(e) };
      }
    }
    return out;
  });
