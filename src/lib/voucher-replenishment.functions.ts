/**
 * Admin-facing entry points for automatic Voucher Shop stock replenishment.
 *
 * Everything is scoped to one shop and re-authorised on the server; the browser
 * only ever asks "how is this shop's stock doing" or "check it now".
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
  if (admin.data !== true) throw new Error("Only this shop's admin can manage voucher stock.");
}

export interface ProductStockState {
  productId: string;
  available: number;
  hasCalibration: boolean;
  lastRun: {
    status: string;
    imported: number;
    error: string | null;
    at: string;
  } | null;
}

/** Voucher Shop availability + calibration state for every product of a shop. */
export const getVoucherStockState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { ecosystemId: string }) => {
    if (!data?.ecosystemId) throw new Error("A shop is required.");
    return data;
  })
  .handler(async ({ data, context }): Promise<{ products: ProductStockState[] }> => {
    await assertShopAdmin(context as unknown as AuthContext, data.ecosystemId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { availableStock } = await import("./voucher-replenishment");

    const [products, codes, calibrations, runs] = await Promise.all([
      supabaseAdmin
        .from("voucher_products")
        .select("id")
        .eq("ecosystem_id", data.ecosystemId)
        .eq("archived", false),
      supabaseAdmin
        .from("voucher_codes")
        .select("product_id, status, sold_to, sale_id")
        .eq("ecosystem_id", data.ecosystemId),
      supabaseAdmin
        .from("omada_voucher_calibrations")
        .select("product_id")
        .eq("ecosystem_id", data.ecosystemId)
        .eq("is_current", true),
      supabaseAdmin
        .from("voucher_replenishment_runs")
        .select("product_id, status, imported_count, error, created_at")
        .eq("ecosystem_id", data.ecosystemId)
        .order("created_at", { ascending: false })
        .limit(200),
    ]);

    const byProduct = new Map<string, Array<{ status: string; sold_to: string | null; sale_id: string | null }>>();
    for (const row of (codes.data ?? []) as Array<{
      product_id: string;
      status: string;
      sold_to: string | null;
      sale_id: string | null;
    }>) {
      const list = byProduct.get(row.product_id) ?? [];
      list.push(row);
      byProduct.set(row.product_id, list);
    }
    const calibrated = new Set(
      ((calibrations.data ?? []) as Array<{ product_id: string }>).map((r) => r.product_id),
    );
    const latest = new Map<string, { status: string; imported: number; error: string | null; at: string }>();
    for (const run of (runs.data ?? []) as Array<{
      product_id: string;
      status: string;
      imported_count: number;
      error: string | null;
      created_at: string;
    }>) {
      if (!latest.has(run.product_id)) {
        latest.set(run.product_id, {
          status: run.status,
          imported: run.imported_count,
          error: run.error,
          at: run.created_at,
        });
      }
    }

    return {
      products: ((products.data ?? []) as Array<{ id: string }>).map((p) => ({
        productId: p.id,
        available: availableStock(byProduct.get(p.id) ?? []),
        hasCalibration: calibrated.has(p.id),
        lastRun: latest.get(p.id) ?? null,
      })),
    };
  });

/**
 * Admin: check ONE exact Voucher Shop product of this shop and top it up when
 * it is below the threshold. A product id is mandatory: no caller may ever
 * trigger a shop-wide loop that would generate for unrelated products.
 */
export const checkVoucherReplenishment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { ecosystemId: string; productId: string }) => {
    if (!data?.ecosystemId) throw new Error("A shop is required.");
    if (!data?.productId) throw new Error("A voucher product is required.");
    return data;
  })
  .handler(async ({ data, context }) => {
    await assertShopAdmin(context as unknown as AuthContext, data.ecosystemId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { replenishProduct } = await import("./voucher-replenishment.server");
    const r = await replenishProduct(supabaseAdmin as never, {
      ecosystemId: data.ecosystemId,
      productId: data.productId,
      trigger: "admin",
    });
    return {
      results: [
        {
          productId: r.productId,
          status: r.status,
          reason: r.reason,
          available: r.available,
          imported: r.imported,
          error: r.error,
        },
      ],
    };
  });
