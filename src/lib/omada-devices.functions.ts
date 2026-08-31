/**
 * Antenna (Omada managed device) server operations, always scoped to ONE shop.
 *
 * Management — inventory of every site device, assignment and unrestricted
 * reboot — is Admin/Super Admin only. An ordinary member sees ONLY the
 * antennas assigned to them in that shop, and may reboot only those. Every
 * permission is re-checked on the server; the browser never receives the
 * controller address, credentials or token.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { describeDeviceStatus, normaliseMac, type AntennaView } from "./omada-devices";

type AuthContext = {
  supabase: {
    rpc: (
      fn: string,
      args: unknown,
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
  };
  userId: string;
};

async function isOwner(context: AuthContext) {
  const owner = await context.supabase.rpc("is_super_admin", { _user_id: context.userId });
  if (owner.error) throw new Error(owner.error.message);
  return owner.data === true;
}

async function isShopAdmin(context: AuthContext, ecosystemId: string) {
  if (await isOwner(context)) return true;
  const admin = await context.supabase.rpc("is_ecosystem_admin", {
    _user_id: context.userId,
    _ecosystem_id: ecosystemId,
  });
  if (admin.error) throw new Error(admin.error.message);
  return admin.data === true;
}

async function assertShopAdmin(context: AuthContext, ecosystemId: string) {
  if (!(await isShopAdmin(context, ecosystemId)))
    throw new Error("Only this shop's admin can manage antennas.");
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

export interface AntennaList {
  /** The shop has an Omada controller connected. */
  configured: boolean;
  /** Controller could not be read; assignments are still returned. */
  error: string | null;
  devices: AntennaView[];
}

interface AssignmentRow {
  device_mac: string;
  device_name: string | null;
  device_type: string | null;
  assigned_user_id: string;
  created_at: string;
}

type AdminClient = {
  from: (table: string) => any;
};

async function loadAssignments(admin: AdminClient, ecosystemId: string) {
  const { data, error } = await admin
    .from("omada_device_assignments")
    .select("device_mac, device_name, device_type, assigned_user_id, created_at")
    .eq("ecosystem_id", ecosystemId)
    .eq("active", true);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as AssignmentRow[];
  const ids = [...new Set(rows.map((r) => r.assigned_user_id))];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, full_name, handle")
      .in("id", ids);
    for (const p of (profiles ?? []) as Array<{
      id: string;
      full_name: string | null;
      handle: string | null;
    }>) {
      names.set(p.id, p.full_name ?? (p.handle ? `@${p.handle}` : "Member"));
    }
  }
  const byMac = new Map<string, { row: AssignmentRow; name: string }>();
  for (const row of rows) {
    byMac.set(normaliseMac(row.device_mac), {
      row,
      name: names.get(row.assigned_user_id) ?? "Member",
    });
  }
  return byMac;
}

async function buildAntennas(ecosystemId: string): Promise<AntennaList> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const admin = supabaseAdmin as unknown as AdminClient;
  const assignments = await loadAssignments(admin, ecosystemId);

  const { openOmadaSession } = await import("./omada-api.server");
  const { listSiteDevices } = await import("./omada-devices.server");

  let devices: AntennaView[] = [];
  let error: string | null = null;
  let configured = true;
  try {
    const session = await openOmadaSession(supabaseAdmin as never, ecosystemId);
    const rows = await listSiteDevices(session);
    devices = rows.map((d) => {
      const status = describeDeviceStatus(d.status, d.detailStatus);
      const assigned = assignments.get(normaliseMac(d.mac));
      assignments.delete(normaliseMac(d.mac));
      return {
        mac: d.mac,
        name: d.name,
        deviceType: d.type,
        model: d.model,
        ip: d.ip,
        publicIp: d.publicIp,
        serial: d.serial,
        firmware: d.firmware,
        uptime: d.uptime,
        cpuPercent: d.cpuPercent,
        memoryPercent: d.memoryPercent,
        lastSeen: d.lastSeen,
        health: status.health,
        statusLabel: status.label,
        statusCode: d.status,
        detailStatusCode: d.detailStatus,
        assignedUserId: assigned?.row.assigned_user_id ?? null,
        assignedUserName: assigned?.name ?? null,
        assignedAt: assigned?.row.created_at ?? null,
        missingFromController: false,
      } satisfies AntennaView;
    });
    // Keep the freshest device name/type on the assignment record.
    for (const d of rows) {
      await admin
        .from("omada_device_assignments")
        .update({ device_name: d.name, device_type: d.type, last_seen_at: new Date().toISOString() })
        .eq("ecosystem_id", ecosystemId)
        .eq("active", true)
        .ilike("device_mac", d.mac);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes("no Omada controller connected")) configured = false;
    else error = message;
  }

  // Assignments the controller no longer lists are preserved, never dropped.
  for (const [mac, assigned] of assignments) {
    devices.push({
      mac,
      name: assigned.row.device_name ?? mac,
      deviceType: assigned.row.device_type ?? "device",
      model: null,
      ip: null,
      publicIp: null,
      serial: null,
      firmware: null,
      uptime: null,
      cpuPercent: null,
      memoryPercent: null,
      lastSeen: null,
      health: "unknown",
      statusLabel: configured && !error ? "Not listed by the controller" : "Status unavailable",
      statusCode: null,
      detailStatusCode: null,
      assignedUserId: assigned.row.assigned_user_id,
      assignedUserName: assigned.name,
      assignedAt: assigned.row.created_at,
      missingFromController: true,
    });
  }

  devices.sort((a, b) => a.name.localeCompare(b.name));
  return { configured, error, devices };
}

/** Admin: every managed device on this shop's site, with its assignment. */
export const listShopAntennas = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { ecosystemId: string }) => {
    if (!data?.ecosystemId) throw new Error("A shop is required.");
    return data;
  })
  .handler(async ({ data, context }): Promise<AntennaList> => {
    await assertShopAdmin(context as unknown as AuthContext, data.ecosystemId);
    return buildAntennas(data.ecosystemId);
  });

/** Member: only the antennas assigned to the signed-in member in this shop. */
export const listMyAntennas = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { ecosystemId: string }) => {
    if (!data?.ecosystemId) throw new Error("A shop is required.");
    return data;
  })
  .handler(async ({ data, context }): Promise<AntennaList> => {
    const ctx = context as unknown as AuthContext;
    await assertShopMember(ctx, data.ecosystemId);
    const all = await buildAntennas(data.ecosystemId);
    return { ...all, devices: all.devices.filter((d) => d.assignedUserId === ctx.userId) };
  });

export interface ShopMemberOption {
  userId: string;
  name: string;
  handle: string | null;
  role: string;
}

/** Admin: members of this shop who may receive an antenna. */
export const listAntennaAssignees = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { ecosystemId: string }) => {
    if (!data?.ecosystemId) throw new Error("A shop is required.");
    return data;
  })
  .handler(async ({ data, context }): Promise<ShopMemberOption[]> => {
    await assertShopAdmin(context as unknown as AuthContext, data.ecosystemId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: members, error } = await supabaseAdmin
      .from("ecosystem_memberships")
      .select("user_id, role")
      .eq("ecosystem_id", data.ecosystemId)
      .eq("membership_state", "active");
    if (error) throw new Error(error.message);
    const rows = (members ?? []) as Array<{ user_id: string; role: string }>;
    if (!rows.length) return [];
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, handle")
      .in(
        "id",
        rows.map((r) => r.user_id),
      );
    const byId = new Map(
      ((profiles ?? []) as Array<{ id: string; full_name: string | null; handle: string | null }>).map(
        (p) => [p.id, p],
      ),
    );
    return rows
      .map((r) => {
        const p = byId.get(r.user_id);
        return {
          userId: r.user_id,
          name: p?.full_name ?? (p?.handle ? `@${p.handle}` : "Member"),
          handle: p?.handle ?? null,
          role: r.role,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  });

/** Admin: give one antenna to one member of the same shop (reassign is safe). */
export const assignAntenna = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      ecosystemId: string;
      mac: string;
      userId: string;
      deviceName?: string;
      deviceType?: string;
    }) => {
      if (!data?.ecosystemId) throw new Error("A shop is required.");
      if (!data?.mac) throw new Error("An antenna is required.");
      if (!data?.userId) throw new Error("A member is required.");
      return data;
    },
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as AuthContext;
    await assertShopAdmin(ctx, data.ecosystemId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const mac = normaliseMac(data.mac);

    const { data: membership, error: memberError } = await supabaseAdmin
      .from("ecosystem_memberships")
      .select("user_id")
      .eq("ecosystem_id", data.ecosystemId)
      .eq("user_id", data.userId)
      .eq("membership_state", "active")
      .maybeSingle();
    if (memberError) throw new Error(memberError.message);
    if (!membership) throw new Error("That person is not an active member of this shop.");

    await supabaseAdmin
      .from("omada_device_assignments")
      .update({ active: false })
      .eq("ecosystem_id", data.ecosystemId)
      .eq("active", true)
      .ilike("device_mac", mac);

    const { error } = await supabaseAdmin.from("omada_device_assignments").insert({
      ecosystem_id: data.ecosystemId,
      device_mac: mac,
      device_name: data.deviceName ?? null,
      device_type: data.deviceType ?? null,
      assigned_user_id: data.userId,
      assigned_by: ctx.userId,
      active: true,
    });
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("audit_logs").insert({
      ecosystem_id: data.ecosystemId,
      actor_id: ctx.userId,
      action: "Assigned antenna",
      target: data.deviceName ?? mac,
      metadata: { mac, device_type: data.deviceType ?? null, member: data.userId },
    });
    return { ok: true };
  });

/** Admin: take an antenna back. History rows stay, only the active flag drops. */
export const unassignAntenna = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { ecosystemId: string; mac: string }) => {
    if (!data?.ecosystemId) throw new Error("A shop is required.");
    if (!data?.mac) throw new Error("An antenna is required.");
    return data;
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as AuthContext;
    await assertShopAdmin(ctx, data.ecosystemId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const mac = normaliseMac(data.mac);
    const { error } = await supabaseAdmin
      .from("omada_device_assignments")
      .update({ active: false })
      .eq("ecosystem_id", data.ecosystemId)
      .eq("active", true)
      .ilike("device_mac", mac);
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("audit_logs").insert({
      ecosystem_id: data.ecosystemId,
      actor_id: ctx.userId,
      action: "Unassigned antenna",
      target: mac,
      metadata: { mac },
    });
    return { ok: true };
  });

/**
 * Restart one antenna on this shop's controller.
 *
 * Allowed for this shop's admin (any device) and for the member the antenna is
 * assigned to (that device only). Every restart is written to the audit trail.
 */
export const rebootAntenna = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { ecosystemId: string; mac: string }) => {
    if (!data?.ecosystemId) throw new Error("A shop is required.");
    if (!data?.mac) throw new Error("An antenna is required.");
    return data;
  })
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const ctx = context as unknown as AuthContext;
    const mac = normaliseMac(data.mac);
    const admin = await isShopAdmin(ctx, data.ecosystemId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (!admin) {
      await assertShopMember(ctx, data.ecosystemId);
      const { data: owned, error } = await supabaseAdmin
        .from("omada_device_assignments")
        .select("id")
        .eq("ecosystem_id", data.ecosystemId)
        .eq("assigned_user_id", ctx.userId)
        .eq("active", true)
        .ilike("device_mac", mac)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!owned) throw new Error("This antenna is not assigned to you.");
    }

    const { openOmadaSession } = await import("./omada-api.server");
    const { rebootSiteDevice } = await import("./omada-devices.server");
    const session = await openOmadaSession(supabaseAdmin as never, data.ecosystemId);
    await rebootSiteDevice(session, mac);

    await supabaseAdmin.from("audit_logs").insert({
      ecosystem_id: data.ecosystemId,
      actor_id: ctx.userId,
      action: "Restarted antenna",
      target: mac,
      metadata: { mac, by: admin ? "shop_admin" : "assigned_member" },
    });
    return { ok: true };
  });

/* -------------------------------------------------------------------------
 * Extended Omada device management — ADMIN ONLY.
 *
 * Every function below re-checks shop-admin rights on the server for the shop
 * it is given, so resellers, subresellers and customers can never reach them
 * even if they call the endpoint directly. Only capabilities verified live on
 * the connected controller are exposed.
 * ---------------------------------------------------------------------- */

async function adminSession(context: AuthContext, ecosystemId: string) {
  await assertShopAdmin(context, ecosystemId);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { openOmadaSession } = await import("./omada-api.server");
  const session = await openOmadaSession(supabaseAdmin as never, ecosystemId);
  return { session, supabaseAdmin };
}

async function logDeviceAction(
  admin: { from: (t: string) => any },
  ecosystemId: string,
  actorId: string,
  action: string,
  mac: string,
  metadata: Record<string, unknown> = {},
) {
  await admin.from("audit_logs").insert({
    ecosystem_id: ecosystemId,
    actor_id: actorId,
    action,
    target: mac,
    metadata: { mac, ...metadata },
  });
}

export interface DeviceManagementView {
  firmware: {
    current: string | null;
    latest: string | null;
    releaseLog: string | null;
    updateAvailable: boolean;
  } | null;
  firmwareError: string | null;
  adopt: { errorCode: number | null; failedType: number | null } | null;
  radios: Array<{
    band: string;
    radioEnable: boolean;
    channel: string | null;
    freq: number | null;
    channelWidth: string | null;
    txPower: number | null;
    txPowerLevel: number | null;
    wirelessMode: number | null;
  }>;
  radioError: string | null;
  channelOptions: Array<{
    band: string;
    radioId: number | null;
    channel: string;
    freq: number | null;
    label: string;
    maxPower: number | null;
  }>;
  clients: Array<{
    mac: string;
    name: string;
    wireless: boolean;
    ssid: string | null;
    channel: number | null;
    guest: boolean;
  }>;
  clientsError: string | null;
}

/** Admin: everything the controller will actually tell us about one device. */
export const getAntennaDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { ecosystemId: string; mac: string; deviceType?: string }) => {
    if (!data?.ecosystemId) throw new Error("A shop is required.");
    if (!data?.mac) throw new Error("A device is required.");
    return data;
  })
  .handler(async ({ data, context }): Promise<DeviceManagementView> => {
    const { session } = await adminSession(context as unknown as AuthContext, data.ecosystemId);
    const mac = normaliseMac(data.mac);
    const isAp = (data.deviceType ?? "").toLowerCase() === "ap";
    const {
      getDeviceFirmware,
      getAdoptResult,
      getApRadioConfig,
      getApChannelOptions,
      listDeviceClients,
    } = await import("./omada-devices.server");

    const view: DeviceManagementView = {
      firmware: null,
      firmwareError: null,
      adopt: null,
      radios: [],
      radioError: null,
      channelOptions: [],
      clients: [],
      clientsError: null,
    };

    try {
      view.firmware = await getDeviceFirmware(session, mac);
    } catch (e) {
      view.firmwareError = e instanceof Error ? e.message : String(e);
    }
    try {
      view.adopt = await getAdoptResult(session, mac);
    } catch {
      view.adopt = null;
    }
    if (isAp) {
      try {
        view.radios = await getApRadioConfig(session, mac);
      } catch (e) {
        view.radioError = e instanceof Error ? e.message : String(e);
      }
      try {
        view.channelOptions = await getApChannelOptions(session, mac);
      } catch {
        view.channelOptions = [];
      }
    }
    try {
      view.clients = await listDeviceClients(session, mac);
    } catch (e) {
      view.clientsError = e instanceof Error ? e.message : String(e);
    }
    return view;
  });

/** Admin: change one AP's radio settings (channel, width, power, on/off). */
export const updateAntennaRadio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      ecosystemId: string;
      mac: string;
      updates: Array<{
        band: "2g" | "5g" | "5g1" | "5g2" | "6g";
        radioEnable?: boolean;
        channel?: string;
        freq?: number;
        channelWidth?: string;
        txPowerLevel?: number;
        txPower?: number;
      }>;
    }) => {
      if (!data?.ecosystemId) throw new Error("A shop is required.");
      if (!data?.mac) throw new Error("A device is required.");
      if (!data?.updates?.length) throw new Error("Nothing to change.");
      return data;
    },
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as AuthContext;
    const { session, supabaseAdmin } = await adminSession(ctx, data.ecosystemId);
    const mac = normaliseMac(data.mac);
    const { updateApRadioConfig, getApRadioConfig } = await import("./omada-devices.server");
    await updateApRadioConfig(session, mac, data.updates);
    await logDeviceAction(supabaseAdmin as never, data.ecosystemId, ctx.userId, "Changed antenna radio settings", mac, {
      updates: data.updates,
    });
    // Read the controller back so the interface shows what was really stored.
    return { ok: true as const, radios: await getApRadioConfig(session, mac) };
  });

type SimpleAction = "locate-on" | "locate-off" | "force-provision" | "forget" | "upgrade" | "adopt";

/** Admin: one supported controller action against one device on this shop's site. */
export const runAntennaAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { ecosystemId: string; mac: string; action: SimpleAction }) => {
    if (!data?.ecosystemId) throw new Error("A shop is required.");
    if (!data?.mac) throw new Error("A device is required.");
    const allowed: SimpleAction[] = [
      "locate-on",
      "locate-off",
      "force-provision",
      "forget",
      "upgrade",
      "adopt",
    ];
    if (!allowed.includes(data.action)) throw new Error("That action is not supported.");
    return data;
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as AuthContext;
    const { session, supabaseAdmin } = await adminSession(ctx, data.ecosystemId);
    const mac = normaliseMac(data.mac);
    const ops = await import("./omada-devices.server");

    let label = "";
    switch (data.action) {
      case "locate-on":
        await ops.locateDevice(session, mac, true);
        label = "Started device locate (LED)";
        break;
      case "locate-off":
        await ops.locateDevice(session, mac, false);
        label = "Stopped device locate (LED)";
        break;
      case "force-provision":
        await ops.forceProvisionDevice(session, mac);
        label = "Forced device reprovision";
        break;
      case "forget":
        await ops.forgetDevice(session, mac);
        label = "Removed device from the site";
        break;
      case "upgrade":
        await ops.startOnlineUpgrade(session, mac);
        label = "Started device firmware upgrade";
        break;
      case "adopt":
        await ops.startAdopt(session, mac);
        label = "Started device adoption";
        break;
    }

    if (data.action === "forget") {
      // The device is gone from the controller; keep the assignment history but
      // stop presenting it as an active assignment.
      await supabaseAdmin
        .from("omada_device_assignments")
        .update({ active: false })
        .eq("ecosystem_id", data.ecosystemId)
        .eq("active", true)
        .ilike("device_mac", mac);
    }

    await logDeviceAction(supabaseAdmin as never, data.ecosystemId, ctx.userId, label, mac);
    return { ok: true as const, label };
  });
