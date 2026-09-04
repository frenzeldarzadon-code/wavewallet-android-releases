/**
 * Live Voucher Monitoring — customer-facing server functions.
 *
 * Every call re-derives the shop from `ecosystemId` and re-authorises the
 * caller as a member of that shop, so a customer can only ever read their own
 * monitoring list and only ever against their own shop's controller. Monitoring
 * is strictly read-only with respect to the voucher itself: nothing here
 * redeems, edits, sells, deletes or reserves a code, and the only row that ever
 * changes is the caller's own private monitoring entry.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  monitoringList,
  toLocalUserView,
  toMonitorCard,
  type LocalUserView,
  type MonitorCard,
  type MonitorRecord,
  type OwnedCode,
} from "./voucher-monitoring";
import { mergeCustomerShops, relatedShopIds, type CustomerShop } from "./customer-shops";

type AuthContext = {
  supabase: {
    rpc: (fn: string, args: unknown) => Promise<{ data: unknown; error: { message: string } | null }>;
  };
  userId: string;
};

/**
 * Monitoring entitlement — the existing rule, applied server-side:
 * platform owner, active member of the shop, or a customer who owns a voucher
 * this shop issued (a Universe purchase never makes the buyer a member, but it
 * does entitle them to watch what they bought). Browsing grants nothing.
 */
async function assertShopMember(context: AuthContext, ecosystemId: string) {
  const owner = await context.supabase.rpc("is_super_admin", { _user_id: context.userId });
  if (owner.error) throw new Error(owner.error.message);
  if (owner.data === true) return;
  const member = await context.supabase.rpc("has_membership", {
    _user_id: context.userId,
    _ecosystem_id: ecosystemId,
  });
  if (member.error) throw new Error(member.error.message);
  if (member.data === true) return;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { count, error } = await supabaseAdmin
    .from("voucher_codes")
    .select("id", { count: "exact", head: true })
    .eq("ecosystem_id", ecosystemId)
    .eq("sold_to", context.userId);
  if (error) throw new Error(error.message);
  if ((count ?? 0) > 0) return;
  throw new Error("You can only monitor shops you belong to or have bought vouchers from.");
}

/**
 * Shops this member may open in the Universe customer portal, with the facts
 * that decide Live Monitoring and Reward Shops eligibility. Every input is the
 * caller's own row; nothing about other members is read.
 */
export const listCustomerShops = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CustomerShop[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as Admin;
    const userId = context.userId;
    const [memberships, vouchers, points] = await Promise.all([
      admin
        .from("ecosystem_memberships")
        .select("ecosystem_id, role")
        .eq("user_id", userId)
        .eq("membership_state", "active"),
      admin.from("voucher_codes").select("ecosystem_id").eq("sold_to", userId),
      admin
        .from("points_accounts")
        .select("ecosystem_id, balance")
        .eq("user_id", userId)
        .not("ecosystem_id", "is", null),
    ]);
    for (const r of [memberships, vouchers, points]) {
      if (r.error) throw new Error(r.error.message);
    }
    const ids = relatedShopIds({
      memberships: memberships.data ?? [],
      vouchers: vouchers.data ?? [],
      points: points.data ?? [],
    });
    if (ids.length === 0) return [];
    const [shops, controllers] = await Promise.all([
      admin
        .from("ecosystems")
        .select("id, name, slug, retail_logo_path, archived_at")
        .in("id", ids)
        .is("archived_at", null),
      admin.from("omada_connections").select("ecosystem_id").in("ecosystem_id", ids),
    ]);
    if (shops.error) throw new Error(shops.error.message);
    return mergeCustomerShops({
      memberships: memberships.data ?? [],
      vouchers: vouchers.data ?? [],
      points: points.data ?? [],
      shops: ((shops.data ?? []) as Array<Record<string, unknown>>).map((s) => ({
        id: s["id"] as string,
        name: s["name"] as string,
        slug: s["slug"] as string,
        logo_path: (s["retail_logo_path"] as string | null) ?? null,
        archived_at: (s["archived_at"] as string | null) ?? null,
      })),
      controllers: controllers.data ?? [],
    });
  });

const CODE_RE = /^[A-Za-z0-9-]{4,64}$/;

function cleanCode(raw: unknown): string {
  const code = String(raw ?? "").trim().toUpperCase();
  if (!CODE_RE.test(code)) throw new Error("Enter a valid voucher code.");
  return code;
}

export interface MonitoringSnapshot {
  configured: boolean;
  /** Cards in list order; one per monitored voucher the controller knows. */
  cards: MonitorCard[];
  /** Monitored codes the controller could not report on right now. */
  unreadable: string[];
  /** ISO timestamp of this controller read; null when the read failed. */
  checkedAt: string | null;
  /** True only when this shop's controller publishes local-user records. */
  localUserAvailable: boolean;
  error: string | null;
}

const EMPTY: MonitoringSnapshot = {
  configured: false,
  cards: [],
  unreadable: [],
  checkedAt: null,
  localUserAvailable: false,
  error: null,
};

type Admin = { from: (table: string) => any };

/** Purchased vouchers + manual additions − switched-off entries. */
async function listFor(admin: Admin, userId: string, ecosystemId: string) {
  const [{ data: owned }, { data: records }, { data: products }] = await Promise.all([
    admin
      .from("voucher_codes")
      .select("code, product_id")
      .eq("ecosystem_id", ecosystemId)
      .eq("sold_to", userId),
    admin
      .from("voucher_monitors")
      .select("code, source, monitoring, product_id")
      .eq("ecosystem_id", ecosystemId)
      .eq("user_id", userId),
    admin.from("voucher_products").select("id, name").eq("ecosystem_id", ecosystemId),
  ]);
  const names = new Map<string, string>();
  for (const p of (products ?? []) as Array<{ id: string; name: string }>) names.set(p.id, p.name);

  const ownedCodes: OwnedCode[] = ((owned ?? []) as Array<{ code: string; product_id: string | null }>)
    .map((c) => ({ code: c.code, productName: c.product_id ? (names.get(c.product_id) ?? null) : null }));
  const monitorRecords: MonitorRecord[] = (
    (records ?? []) as Array<{
      code: string;
      source: "manual" | "purchase";
      monitoring: boolean;
      product_id: string | null;
    }>
  ).map((r) => ({
    code: r.code,
    source: r.source,
    monitoring: r.monitoring,
    productName: r.product_id ? (names.get(r.product_id) ?? null) : null,
  }));
  return monitoringList(ownedCodes, monitorRecords);
}

/** The customer's live monitoring board, read from Omada in one sweep. */
export const getVoucherMonitoring = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { ecosystemId: string }) => {
    if (!data?.ecosystemId) throw new Error("A shop is required.");
    return data;
  })
  .handler(async ({ data, context }): Promise<MonitoringSnapshot> => {
    await assertShopMember(context as unknown as AuthContext, data.ecosystemId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const list = await listFor(supabaseAdmin as unknown as Admin, context.userId, data.ecosystemId);
    if (list.length === 0) {
      const { openOmadaSession } = await import("./omada-api.server");
      try {
        const session = await openOmadaSession(supabaseAdmin as never, data.ecosystemId);
        const { localUserSupported } = await import("./voucher-monitoring.server");
        return {
          ...EMPTY,
          configured: true,
          checkedAt: new Date().toISOString(),
          localUserAvailable: await localUserSupported(session).catch(() => false),
        };
      } catch {
        return { ...EMPTY, configured: true };
      }
    }

    const { openOmadaSession } = await import("./omada-api.server");
    const { fetchVoucherRows, localUserSupported } = await import("./voucher-monitoring.server");
    try {
      const session = await openOmadaSession(supabaseAdmin as never, data.ecosystemId);
      const rows = await fetchVoucherRows(
        session,
        list.map((l) => l.code),
      );
      const cards: MonitorCard[] = [];
      const unreadable: string[] = [];
      for (const entry of list) {
        const hit = rows.get(entry.code);
        const card = hit
          ? toMonitorCard(entry.code, hit.row, hit.group, entry.productName ?? null)
          : null;
        if (card) cards.push(card);
        else unreadable.push(entry.code);
      }
      return {
        configured: true,
        cards,
        unreadable,
        checkedAt: new Date().toISOString(),
        localUserAvailable: await localUserSupported(session).catch(() => false),
        error: null,
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (message.includes("no Omada controller connected")) return EMPTY;
      return {
        ...EMPTY,
        configured: true,
        unreadable: list.map((l) => l.code),
        error:
          "Unable to refresh — the hotspot controller could not be reached. The values shown are the last ones it reported.",
      };
    }
  });

/**
 * Adds one voucher to this customer's private monitoring list.
 *
 * The code must belong to this exact shop: either it is one of the shop's own
 * issued codes, or this shop's controller knows it. A code from another shop is
 * refused, so a voucher code alone is never a cross-shop identity.
 */
export const addMonitoredVoucher = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { ecosystemId: string; code: string }) => {
    if (!data?.ecosystemId) throw new Error("A shop is required.");
    return { ecosystemId: data.ecosystemId, code: cleanCode(data.code) };
  })
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await assertShopMember(context as unknown as AuthContext, data.ecosystemId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: known } = await supabaseAdmin
      .from("voucher_codes")
      .select("code, product_id")
      .eq("ecosystem_id", data.ecosystemId)
      .eq("code", data.code)
      .maybeSingle();

    let productId: string | null = (known?.["product_id"] as string | null) ?? null;
    if (!known) {
      // Not one of the shop's own issued codes — the shop's controller must
      // recognise it before it may be monitored here.
      const { openOmadaSession } = await import("./omada-api.server");
      const { fetchVoucherRows } = await import("./voucher-monitoring.server");
      try {
        const session = await openOmadaSession(supabaseAdmin as never, data.ecosystemId);
        const rows = await fetchVoucherRows(session, [data.code]);
        if (!rows.has(data.code)) {
          throw new Error("This voucher does not belong to this shop.");
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (message.includes("does not belong")) throw e;
        throw new Error(
          "The hotspot controller could not be reached, so this voucher could not be verified. Please try again shortly.",
        );
      }
    }

    const { error } = await supabaseAdmin.from("voucher_monitors").upsert(
      {
        user_id: context.userId,
        ecosystem_id: data.ecosystemId,
        code: data.code,
        product_id: productId,
        source: "manual",
        monitoring: true,
      },
      { onConflict: "user_id,ecosystem_id,code" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Stops monitoring one voucher for this customer only.
 *
 * This writes a single private row. The voucher itself, the shop's stock, the
 * sale, the wallet and every other customer's list are untouched.
 */
export const stopMonitoringVoucher = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { ecosystemId: string; code: string }) => {
    if (!data?.ecosystemId) throw new Error("A shop is required.");
    return { ecosystemId: data.ecosystemId, code: cleanCode(data.code) };
  })
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await assertShopMember(context as unknown as AuthContext, data.ecosystemId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("voucher_monitors").upsert(
      {
        user_id: context.userId,
        ecosystem_id: data.ecosystemId,
        code: data.code,
        source: "manual",
        monitoring: false,
      },
      { onConflict: "user_id,ecosystem_id,code" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export interface LocalUserResult {
  available: boolean;
  view: LocalUserView | null;
  checkedAt: string | null;
  error: string | null;
}

/**
 * Verifies a local-user credential against this shop's controller and returns
 * what the controller currently reports for that account. The password is used
 * for the controller check only and is never stored.
 */
export const monitorLocalUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { ecosystemId: string; username: string; password: string }) => {
    if (!data?.ecosystemId) throw new Error("A shop is required.");
    const username = String(data.username ?? "").trim();
    const password = String(data.password ?? "");
    if (!username || !password) throw new Error("Enter your username and password.");
    return { ecosystemId: data.ecosystemId, username, password };
  })
  .handler(async ({ data, context }): Promise<LocalUserResult> => {
    await assertShopMember(context as unknown as AuthContext, data.ecosystemId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { openOmadaSession } = await import("./omada-api.server");
    const { findLocalUser, localUserSupported } = await import("./voucher-monitoring.server");
    try {
      const session = await openOmadaSession(supabaseAdmin as never, data.ecosystemId);
      if (!(await localUserSupported(session))) {
        return { available: false, view: null, checkedAt: null, error: null };
      }
      const row = await findLocalUser(session, data.username, data.password);
      if (!row) {
        return {
          available: true,
          view: null,
          checkedAt: new Date().toISOString(),
          error: "The controller did not accept that username and password.",
        };
      }
      return {
        available: true,
        view: toLocalUserView(row),
        checkedAt: new Date().toISOString(),
        error: null,
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (message.includes("no Omada controller connected")) {
        return { available: false, view: null, checkedAt: null, error: null };
      }
      return {
        available: true,
        view: null,
        checkedAt: null,
        error: "Unable to refresh — the hotspot controller could not be reached.",
      };
    }
  });
