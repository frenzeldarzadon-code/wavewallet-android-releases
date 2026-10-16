/**
 * Omada local users for ONE shop: list/search, create, add GB, extend expiry.
 * Shop admin (or platform owner) only. Passwords and tokens never leave the server.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  authorizeShopAdmin,
  buildAddQuotaBody,
  buildCreateBody,
  buildExpiryBody,
  buildPasswordBody,
  toLocalUserView,
  type ExpiryChange,
  type LocalUserView,
  type NewLocalUser,
} from "./omada-local-users";

type Ctx = {
  supabase: { rpc: (fn: string, args: unknown) => PromiseLike<{ data: unknown; error: { message: string } | null }> };
  userId: string;
};

async function open(context: unknown, ecosystemId: string) {
  const ctx = context as Ctx;
  await authorizeShopAdmin((fn, a) => ctx.supabase.rpc(fn, a), ctx.userId, ecosystemId);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { openOmadaSession } = await import("./omada-api.server");
  const session = await openOmadaSession(supabaseAdmin as never, ecosystemId);
  return { ctx, session, supabaseAdmin };
}

async function audit(
  admin: { from: (t: string) => { insert: (r: unknown) => PromiseLike<unknown> } },
  ecosystemId: string,
  actorId: string,
  action: string,
  target: string,
  metadata: Record<string, unknown>,
) {
  await admin.from("audit_logs").insert({ ecosystem_id: ecosystemId, actor_id: actorId, action, target, metadata });
}

export interface LocalUsersResult {
  supported: boolean;
  reason: string | null;
  users: LocalUserView[];
  portals: { id: string; name: string }[];
}

export const listOmadaLocalUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { ecosystemId: string }) => {
    if (!d?.ecosystemId) throw new Error("A shop is required.");
    return d;
  })
  .handler(async ({ data, context }): Promise<LocalUsersResult> => {
    let opened;
    try {
      opened = await open(context, data.ecosystemId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.startsWith("Only this shop") || msg.includes("required")) throw e;
      return { supported: false, reason: msg, users: [], portals: [] };
    }
    const { listAllLocalUsers } = await import("./omada-local-users.server");
    try {
      const rows = await listAllLocalUsers(opened.session);
      let portals: { id: string; name: string }[] = [];
      try {
        const { discoverPortalCapabilities, listSitePortals } = await import("./omada-portals.server");
        const caps = await discoverPortalCapabilities(opened.session);
        portals = (await listSitePortals(opened.session, caps)).map((p) => ({ id: p.id, name: p.name }));
      } catch {
        portals = [];
      }
      return { supported: true, reason: null, users: rows.map((r) => toLocalUserView(r)), portals };
    } catch (e) {
      return {
        supported: false,
        reason: `Omada did not allow reading local users: ${e instanceof Error ? e.message : String(e)}. Check that this shop's Omada Open API app has Hotspot permission.`,
        users: [],
        portals: [],
      };
    }
  });

export const createOmadaLocalUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { ecosystemId: string; user: NewLocalUser }) => {
    if (!d?.ecosystemId || !d.user) throw new Error("A shop and user details are required.");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { ctx, session, supabaseAdmin } = await open(context, data.ecosystemId);
    const { listAllLocalUsers, createLocalUser } = await import("./omada-local-users.server");
    const body = buildCreateBody(data.user);
    const exists = (await listAllLocalUsers(session)).some(
      (r) => String(r["userName"] ?? "").toLowerCase() === String(body["userName"]).toLowerCase(),
    );
    if (exists) throw new Error("A local user with that username already exists on Omada.");
    await createLocalUser(session, body);
    await audit(supabaseAdmin as never, data.ecosystemId, ctx.userId, "Created Omada local user", String(body["userName"]), {
      expiration: body["expirationTime"],
      traffic_limit_mb: body["trafficLimit"] ?? null,
      max_users: body["maxUsers"],
    });
    return { ok: true };
  });

export const addOmadaLocalUserQuota = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { ecosystemId: string; userId: string; addGb: number }) => {
    if (!d?.ecosystemId || !d.userId) throw new Error("A shop and user are required.");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { ctx, session, supabaseAdmin } = await open(context, data.ecosystemId);
    const { readLocalUser, updateLocalUser } = await import("./omada-local-users.server");
    const current = await readLocalUser(session, data.userId);
    const body = buildAddQuotaBody(current, Number(data.addGb));
    await updateLocalUser(session, current, body);
    const after = await readLocalUser(session, data.userId);
    const usedBefore = Number(current["trafficUsed"] ?? 0);
    const usedAfter = Number(after["trafficUsed"] ?? 0);
    const applied = after["trafficLimit"] === body["trafficLimit"];
    const usageDropped = usedAfter < usedBefore;
    await audit(supabaseAdmin as never, data.ecosystemId, ctx.userId, "Added data to Omada local user", String(current["userName"] ?? ""), {
      user_id: data.userId,
      add_gb: data.addGb,
      limit_mb_before: current["trafficLimit"],
      limit_mb_after: after["trafficLimit"],
      used_bytes_before: usedBefore,
      used_bytes_after: usedAfter,
      applied,
      usage_counter_dropped: usageDropped,
    });
    return { ok: applied, usageDropped, user: toLocalUserView(after) };
  });

export const setOmadaLocalUserExpiry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { ecosystemId: string; userId: string; change: ExpiryChange }) => {
    if (!d?.ecosystemId || !d.userId || !d.change) throw new Error("A shop, user and new expiry are required.");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { ctx, session, supabaseAdmin } = await open(context, data.ecosystemId);
    const { readLocalUser, updateLocalUser } = await import("./omada-local-users.server");
    const current = await readLocalUser(session, data.userId);
    const body = buildExpiryBody(current, data.change);
    await updateLocalUser(session, current, body);
    const after = await readLocalUser(session, data.userId);
    const applied = after["expirationTime"] === body["expirationTime"];
    await audit(supabaseAdmin as never, data.ecosystemId, ctx.userId, "Extended Omada local user expiry", String(current["userName"] ?? ""), {
      user_id: data.userId,
      expiration_before: current["expirationTime"],
      expiration_after: after["expirationTime"],
      applied,
    });
    return { ok: applied, user: toLocalUserView(after) };
  });

export const setOmadaLocalUserPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { ecosystemId: string; userId: string; password: string }) => {
    if (!d?.ecosystemId || !d.userId || typeof d.password !== "string") throw new Error("A shop, user and password are required.");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { ctx, session, supabaseAdmin } = await open(context, data.ecosystemId);
    const { readLocalUser, updateLocalUser } = await import("./omada-local-users.server");
    const current = await readLocalUser(session, data.userId);
    const body = buildPasswordBody(current, data.password);
    await updateLocalUser(session, current, body);
    const after = await readLocalUser(session, data.userId);
    const applied = after["password"] === data.password;
    // Never record the password itself.
    await audit(supabaseAdmin as never, data.ecosystemId, ctx.userId, "Changed Omada local user password", String(current["userName"] ?? ""), {
      user_id: data.userId,
      applied,
      enabled_unchanged: after["enable"] === current["enable"],
    });
    return { ok: applied, user: toLocalUserView(after) };
  });
